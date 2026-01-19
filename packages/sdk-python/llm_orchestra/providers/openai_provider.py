from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional

from .base import BaseProvider
from ..types import CompletionRequest, CompletionResponse, Message, ToolCall, ToolDefinition, TokenUsage

# Pricing as of Jan 2026 (per 1K tokens)
MODEL_PRICING: Dict[str, Dict[str, float]] = {
    "gpt-4-turbo": {"inputPer1k": 0.01, "outputPer1k": 0.03},
    "gpt-4-turbo-preview": {"inputPer1k": 0.01, "outputPer1k": 0.03},
    "gpt-4": {"inputPer1k": 0.03, "outputPer1k": 0.06},
    "gpt-4-32k": {"inputPer1k": 0.06, "outputPer1k": 0.12},
    "gpt-3.5-turbo": {"inputPer1k": 0.0005, "outputPer1k": 0.0015},
    "gpt-3.5-turbo-16k": {"inputPer1k": 0.003, "outputPer1k": 0.004},
    "gpt-4o": {"inputPer1k": 0.005, "outputPer1k": 0.015},
    "gpt-4o-mini": {"inputPer1k": 0.00015, "outputPer1k": 0.0006},
}


class OpenAIProvider(BaseProvider):
    name = "openai"

    def __init__(self, credentials: Dict[str, Any]) -> None:
        super().__init__(credentials)
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise ImportError(
                "OpenAIProvider requires the openai package. Install with `pip install llm-orchestra[openai]`."
            ) from exc

        self.client = OpenAI(
            api_key=credentials.get("apiKey"),
            base_url=credentials.get("baseUrl"),
            organization=credentials.get("organizationId"),
        )

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        start_time = time.time()
        span_id = self.generate_span_id()

        params: Dict[str, Any] = {
            "model": request.get("model"),
            "messages": self._convert_messages(request.get("messages", [])),
        }
        if request.get("maxTokens") is not None:
            params["max_tokens"] = request["maxTokens"]
        if request.get("temperature") is not None:
            params["temperature"] = request["temperature"]
        if request.get("topP") is not None:
            params["top_p"] = request["topP"]
        if request.get("stop"):
            params["stop"] = request["stop"]
        if request.get("tools"):
            params["tools"] = self._convert_tools(request["tools"])
        if request.get("toolChoice") is not None:
            params["tool_choice"] = request["toolChoice"]

        response = await asyncio.to_thread(self.client.chat.completions.create, **params)
        choice = response.choices[0]
        latency_ms = (time.time() - start_time) * 1000

        usage: TokenUsage = {
            "inputTokens": getattr(response.usage, "prompt_tokens", 0),
            "outputTokens": getattr(response.usage, "completion_tokens", 0),
            "totalTokens": getattr(response.usage, "total_tokens", 0),
        }

        tool_calls: Optional[List[ToolCall]] = None
        if getattr(choice.message, "tool_calls", None):
            tool_calls = []
            for tool_call in choice.message.tool_calls:
                tool_calls.append(
                    {
                        "id": tool_call.id,
                        "type": "function",
                        "function": {
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments,
                        },
                    }
                )

        return {
            "content": choice.message.content or "",
            "toolCalls": tool_calls,
            "finishReason": self._map_finish_reason(choice.finish_reason),
            "meta": {
                "latencyMs": latency_ms,
                "tokens": usage,
                "cost": self.calculate_cost(request.get("model", ""), usage),
                "traceId": "",
                "spanId": span_id,
                "model": request.get("model", ""),
                "provider": "openai",
                "cached": False,
                "failoverAttempts": 0,
            },
        }

    async def list_models(self) -> list[str]:
        response = await asyncio.to_thread(self.client.models.list)
        data = getattr(response, "data", [])
        return [model.id for model in data if getattr(model, "id", "").startswith("gpt")]

    def get_model_cost(self, model: str) -> dict[str, float]:
        for key, pricing in MODEL_PRICING.items():
            if key in model or model in key:
                return pricing
        return {"inputPer1k": 0.01, "outputPer1k": 0.03}

    def _convert_messages(self, messages: List[Message]) -> List[Dict[str, Any]]:
        converted = []
        for msg in messages:
            role = msg.get("role")
            if role == "tool" and msg.get("toolCallId"):
                converted.append(
                    {
                        "role": "tool",
                        "tool_call_id": msg.get("toolCallId"),
                        "content": msg.get("content", ""),
                    }
                )
            else:
                converted.append(
                    {
                        "role": role,
                        "content": msg.get("content", ""),
                    }
                )
        return converted

    def _convert_tools(self, tools: List[ToolDefinition]) -> List[Dict[str, Any]]:
        converted = []
        for tool in tools:
            function = tool.get("function", {})
            converted.append(
                {
                    "type": "function",
                    "function": {
                        "name": function.get("name", ""),
                        "description": function.get("description", ""),
                        "parameters": function.get("parameters", {}),
                    },
                }
            )
        return converted

    def _map_finish_reason(self, reason: Optional[str]) -> str:
        if reason in ("stop", "length", "tool_calls", "content_filter"):
            return reason
        return "stop"
