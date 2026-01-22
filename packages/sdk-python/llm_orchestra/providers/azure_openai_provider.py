from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .base import BaseProvider
from ..types import CompletionRequest, CompletionResponse, Message, ToolCall, ToolDefinition, TokenUsage

if TYPE_CHECKING:
    import aiohttp as aiohttp_module

DEFAULT_API_VERSION = "2024-02-15-preview"


class AzureOpenAIProvider(BaseProvider):
    """Azure OpenAI Provider Adapter.

    Handles Azure OpenAI chat completions via deployment-based REST API.
    Requires baseUrl (resource endpoint) and apiKey in credentials.
    """

    name = "azure-openai"
    _aiohttp: "aiohttp_module"

    def __init__(self, credentials: Dict[str, Any]) -> None:
        super().__init__(credentials)
        base_url = credentials.get("baseUrl")
        if not base_url:
            raise ValueError("Azure OpenAI requires baseUrl (resource endpoint).")
        self.base_url = base_url.rstrip("/")
        self.api_version = credentials.get("apiVersion", DEFAULT_API_VERSION)
        self.api_key = credentials.get("apiKey", "")
        self._aiohttp = self._import_aiohttp()

    def _import_aiohttp(self) -> "aiohttp_module":
        try:
            import aiohttp
            return aiohttp
        except ImportError as exc:
            raise ImportError(
                "AzureOpenAIProvider requires aiohttp. Install with `pip install aiohttp`."
            ) from exc

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        start_time = time.time()
        span_id = self.generate_span_id()
        deployment = self._normalize_deployment(request.get("model", ""))

        params: Dict[str, Any] = {
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

        response = await self._fetch_json(deployment, params)
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
                "provider": "azure-openai",
                "cached": False,
                "failoverAttempts": 0,
            },
        }

    async def list_models(self) -> list[str]:
        url = f"{self.base_url}/openai/models?api-version={self.api_version}"
        async with self._aiohttp.ClientSession() as session:
            async with session.get(url, headers=self._build_headers()) as response:
                if not response.ok:
                    error_text = await response.text()
                    raise RuntimeError(f"Azure OpenAI API error: {response.status} {error_text}")
                data = await response.json()
                return [model.get("id", "") for model in data.get("data", [])]

    def get_model_cost(self, model: str) -> dict[str, float]:
        # Azure OpenAI pricing varies by deployment; return zero to avoid misleading costs
        return {"inputPer1k": 0, "outputPer1k": 0}

    async def _fetch_json(self, deployment: str, body: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/openai/deployments/{deployment}/chat/completions?api-version={self.api_version}"
        async with self._aiohttp.ClientSession() as session:
            async with session.post(url, headers=self._build_headers(), json=body) as response:
                if not response.ok:
                    error_text = await response.text()
                    raise RuntimeError(f"Azure OpenAI API error: {response.status} {error_text}")
                return await response.json()

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "api-key": self.api_key,
        }

    def _normalize_deployment(self, model: str) -> str:
        if model.startswith("azure-openai:"):
            return model[len("azure-openai:"):]
        if model.startswith("azure:"):
            return model[len("azure:"):]
        return model

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
