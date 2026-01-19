from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, List, Optional, Tuple

from .base import BaseProvider
from ..types import CompletionRequest, CompletionResponse, Message, ToolDefinition, TokenUsage

# Pricing as of Jan 2026 (per 1K tokens)
MODEL_PRICING: Dict[str, Dict[str, float]] = {
    "claude-3-opus-20240229": {"inputPer1k": 0.015, "outputPer1k": 0.075},
    "claude-3-sonnet-20240229": {"inputPer1k": 0.003, "outputPer1k": 0.015},
    "claude-3-haiku-20240307": {"inputPer1k": 0.00025, "outputPer1k": 0.00125},
    "claude-3-5-sonnet-20241022": {"inputPer1k": 0.003, "outputPer1k": 0.015},
    "claude-3-5-haiku-20241022": {"inputPer1k": 0.001, "outputPer1k": 0.005},
    "claude-3-opus": {"inputPer1k": 0.015, "outputPer1k": 0.075},
    "claude-3-sonnet": {"inputPer1k": 0.003, "outputPer1k": 0.015},
    "claude-3-haiku": {"inputPer1k": 0.00025, "outputPer1k": 0.00125},
    "claude-3.5-sonnet": {"inputPer1k": 0.003, "outputPer1k": 0.015},
    "claude-3.5-haiku": {"inputPer1k": 0.001, "outputPer1k": 0.005},
}

MODEL_ALIASES: Dict[str, str] = {
    "claude-3-opus": "claude-3-opus-20240229",
    "claude-3-sonnet": "claude-3-sonnet-20240229",
    "claude-3-haiku": "claude-3-haiku-20240307",
    "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
    "claude-3.5-haiku": "claude-3-5-haiku-20241022",
}


class AnthropicProvider(BaseProvider):
    name = "anthropic"

    def __init__(self, credentials: Dict[str, Any]) -> None:
        super().__init__(credentials)
        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise ImportError(
                "AnthropicProvider requires the anthropic package. Install with `pip install llm-orchestra[anthropic]`."
            ) from exc

        self.client = Anthropic(
            api_key=credentials.get("apiKey"),
            base_url=credentials.get("baseUrl"),
        )

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        start_time = time.time()
        span_id = self.generate_span_id()
        resolved_model = self._resolve_model(request.get("model", ""))

        system_prompt, messages = self._convert_messages(request.get("messages", []))

        params: Dict[str, Any] = {
            "model": resolved_model,
            "max_tokens": request.get("maxTokens", 4096),
            "messages": messages,
        }
        if system_prompt:
            params["system"] = system_prompt
        if request.get("temperature") is not None:
            params["temperature"] = request["temperature"]
        if request.get("topP") is not None:
            params["top_p"] = request["topP"]
        if request.get("stop"):
            params["stop_sequences"] = request["stop"]
        if request.get("tools"):
            params["tools"] = self._convert_tools(request["tools"])

        response = await asyncio.to_thread(self.client.messages.create, **params)
        latency_ms = (time.time() - start_time) * 1000

        usage: TokenUsage = {
            "inputTokens": response.usage.input_tokens,
            "outputTokens": response.usage.output_tokens,
            "totalTokens": response.usage.input_tokens + response.usage.output_tokens,
        }

        content = ""
        tool_calls: List[dict[str, Any]] = []
        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    {
                        "id": block.id,
                        "type": "function",
                        "function": {
                            "name": block.name,
                            "arguments": json.dumps(block.input),
                        },
                    }
                )

        return {
            "content": content,
            "toolCalls": tool_calls or None,
            "finishReason": self._map_stop_reason(response.stop_reason),
            "meta": {
                "latencyMs": latency_ms,
                "tokens": usage,
                "cost": self.calculate_cost(resolved_model, usage),
                "traceId": "",
                "spanId": span_id,
                "model": resolved_model,
                "provider": "anthropic",
                "cached": False,
                "failoverAttempts": 0,
            },
        }

    async def list_models(self) -> list[str]:
        if hasattr(self.client, "models"):
            response = await asyncio.to_thread(self.client.models.list)
            data = getattr(response, "data", [])
            return [model.id for model in data]
        return []

    def get_model_cost(self, model: str) -> dict[str, float]:
        return MODEL_PRICING.get(model, {"inputPer1k": 0.003, "outputPer1k": 0.015})

    def _resolve_model(self, model: str) -> str:
        return MODEL_ALIASES.get(model, model)

    def _convert_messages(self, messages: List[Message]) -> Tuple[Optional[str], List[Dict[str, str]]]:
        system_prompt = None
        converted: List[Dict[str, str]] = []

        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role == "system" and system_prompt is None:
                system_prompt = content
                continue
            converted.append({"role": role or "user", "content": content})

        return system_prompt, converted

    def _convert_tools(self, tools: List[ToolDefinition]) -> List[Dict[str, Any]]:
        converted = []
        for tool in tools:
            function = tool.get("function", {})
            converted.append(
                {
                    "name": function.get("name", ""),
                    "description": function.get("description", ""),
                    "input_schema": function.get("parameters", {}),
                }
            )
        return converted

    def _map_stop_reason(self, reason: Optional[str]) -> str:
        if reason == "max_tokens":
            return "length"
        if reason == "tool_use":
            return "tool_calls"
        return "stop"
