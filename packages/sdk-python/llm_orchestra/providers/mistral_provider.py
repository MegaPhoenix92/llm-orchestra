from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from .base import BaseProvider
from ..types import CompletionRequest, CompletionResponse, Message, ToolCall, ToolDefinition, TokenUsage

DEFAULT_BASE_URL = "https://api.mistral.ai/v1"

# Pricing varies by model; defaults are zero to avoid misleading costs
MODEL_PRICING: Dict[str, Dict[str, float]] = {
    "mistral-large": {"inputPer1k": 0, "outputPer1k": 0},
    "mistral-medium": {"inputPer1k": 0, "outputPer1k": 0},
    "mistral-small": {"inputPer1k": 0, "outputPer1k": 0},
    "mistral-large-latest": {"inputPer1k": 0, "outputPer1k": 0},
    "mistral-small-latest": {"inputPer1k": 0, "outputPer1k": 0},
}


class MistralProvider(BaseProvider):
    """Mistral Provider Adapter.

    Handles Mistral models via the Mistral API (OpenAI-compatible).
    """

    name = "mistral"

    def __init__(self, credentials: Dict[str, Any]) -> None:
        super().__init__(credentials)
        self.base_url = credentials.get("baseUrl", DEFAULT_BASE_URL)
        self.api_key = credentials.get("apiKey", "")

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

        response = await self._fetch_json("/chat/completions", params)
        latency_ms = (time.time() - start_time) * 1000

        choices = response.get("choices", [])
        choice = choices[0] if choices else {}
        message = choice.get("message", {})
        content = message.get("content") or ""

        usage: TokenUsage = {
            "inputTokens": response.get("usage", {}).get("prompt_tokens", 0),
            "outputTokens": response.get("usage", {}).get("completion_tokens", 0),
            "totalTokens": response.get("usage", {}).get("total_tokens", 0),
        }

        tool_calls: Optional[List[ToolCall]] = None
        if message.get("tool_calls"):
            tool_calls = []
            for tool_call in message["tool_calls"]:
                tool_calls.append({
                    "id": tool_call.get("id", ""),
                    "type": "function",
                    "function": {
                        "name": tool_call.get("function", {}).get("name", ""),
                        "arguments": tool_call.get("function", {}).get("arguments", ""),
                    },
                })

        return {
            "content": content,
            "toolCalls": tool_calls,
            "finishReason": self._map_finish_reason(choice.get("finish_reason")),
            "meta": {
                "latencyMs": latency_ms,
                "tokens": usage,
                "cost": self.calculate_cost(request.get("model", ""), usage),
                "traceId": "",
                "spanId": span_id,
                "model": request.get("model", ""),
                "provider": "mistral",
                "cached": False,
                "failoverAttempts": 0,
            },
        }

    async def list_models(self) -> list[str]:
        response = await self._fetch_json("/models", None, method="GET")
        data = response.get("data", [])
        return [model.get("id", "") for model in data]

    def get_model_cost(self, model: str) -> dict[str, float]:
        for key, pricing in MODEL_PRICING.items():
            if key in model or model in key:
                return pricing
        return {"inputPer1k": 0, "outputPer1k": 0}

    async def _fetch_json(
        self, path: str, body: Optional[Dict[str, Any]], method: str = "POST"
    ) -> Dict[str, Any]:
        try:
            import aiohttp
        except ImportError as exc:
            raise ImportError(
                "MistralProvider requires aiohttp. Install with `pip install aiohttp`."
            ) from exc

        url = f"{self.base_url}{path}"
        async with aiohttp.ClientSession() as session:
            kwargs: Dict[str, Any] = {"headers": self._build_headers()}
            if body is not None:
                kwargs["json"] = body

            async with session.request(method, url, **kwargs) as response:
                if not response.ok:
                    error_text = await response.text()
                    raise RuntimeError(f"Mistral API error: {response.status} {error_text}")
                return await response.json()

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def _convert_messages(self, messages: List[Message]) -> List[Dict[str, Any]]:
        converted = []
        for msg in messages:
            role = msg.get("role")
            if role == "tool" and msg.get("toolCallId"):
                converted.append({
                    "role": "tool",
                    "tool_call_id": msg.get("toolCallId"),
                    "content": msg.get("content", ""),
                })
            else:
                converted.append({
                    "role": role,
                    "content": msg.get("content", ""),
                })
        return converted

    def _convert_tools(self, tools: List[ToolDefinition]) -> List[Dict[str, Any]]:
        converted = []
        for tool in tools:
            function = tool.get("function", {})
            converted.append({
                "type": "function",
                "function": {
                    "name": function.get("name", ""),
                    "description": function.get("description", ""),
                    "parameters": function.get("parameters", {}),
                },
            })
        return converted

    def _map_finish_reason(self, reason: Optional[str]) -> str:
        if reason in ("stop", "length", "tool_calls", "content_filter"):
            return reason
        return "stop"
