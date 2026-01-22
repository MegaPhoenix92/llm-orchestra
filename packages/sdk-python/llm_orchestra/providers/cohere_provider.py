from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

from .base import BaseProvider
from ..types import CompletionRequest, CompletionResponse, Message, TokenUsage

DEFAULT_BASE_URL = "https://api.cohere.ai/v1"

MODEL_PRICING: Dict[str, Dict[str, float]] = {
    "command": {"inputPer1k": 0, "outputPer1k": 0},
    "command-light": {"inputPer1k": 0, "outputPer1k": 0},
    "command-r": {"inputPer1k": 0, "outputPer1k": 0},
    "command-r-plus": {"inputPer1k": 0, "outputPer1k": 0},
}


class CohereProvider(BaseProvider):
    """Cohere Provider Adapter.

    Handles Cohere chat models via the Cohere API.
    Note: Cohere uses a different message format than OpenAI-compatible APIs.
    """

    name = "cohere"

    def __init__(self, credentials: Dict[str, Any]) -> None:
        super().__init__(credentials)
        self.base_url = credentials.get("baseUrl", DEFAULT_BASE_URL)
        self.api_key = credentials.get("apiKey", "")

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        start_time = time.time()
        span_id = self.generate_span_id()

        message, chat_history, system_prompt = self._convert_messages(request.get("messages", []))

        params: Dict[str, Any] = {
            "model": request.get("model"),
            "message": message,
        }
        if system_prompt:
            params["preamble"] = system_prompt
        if chat_history:
            params["chat_history"] = chat_history
        if request.get("temperature") is not None:
            params["temperature"] = request["temperature"]
        if request.get("topP") is not None:
            params["p"] = request["topP"]
        if request.get("maxTokens") is not None:
            params["max_tokens"] = request["maxTokens"]
        if request.get("stop"):
            params["stop_sequences"] = request["stop"]

        response = await self._fetch_json("/chat", params)
        latency_ms = (time.time() - start_time) * 1000

        content = response.get("text") or response.get("message") or ""
        usage = self._extract_usage(response)

        return {
            "content": content,
            "finishReason": self._map_finish_reason(response.get("finish_reason")),
            "meta": {
                "latencyMs": latency_ms,
                "tokens": usage,
                "cost": self.calculate_cost(request.get("model", ""), usage),
                "traceId": "",
                "spanId": span_id,
                "model": request.get("model", ""),
                "provider": "cohere",
                "cached": False,
                "failoverAttempts": 0,
            },
        }

    async def list_models(self) -> list[str]:
        response = await self._fetch_json("/models", None, method="GET")
        models = response.get("models", [])
        return [
            model.get("name") or model.get("id")
            for model in models
            if model.get("name") or model.get("id")
        ]

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
                "CohereProvider requires aiohttp. Install with `pip install aiohttp`."
            ) from exc

        url = f"{self.base_url}{path}"
        async with aiohttp.ClientSession() as session:
            kwargs: Dict[str, Any] = {"headers": self._build_headers()}
            if body is not None:
                kwargs["json"] = body

            async with session.request(method, url, **kwargs) as response:
                if not response.ok:
                    error_text = await response.text()
                    raise RuntimeError(f"Cohere API error: {response.status} {error_text}")
                return await response.json()

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def _convert_messages(
        self, messages: List[Message]
    ) -> Tuple[str, List[Dict[str, str]], Optional[str]]:
        """Convert messages to Cohere format.

        Returns: (message, chat_history, system_prompt)
        """
        system_prompt: Optional[str] = None
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content", "")
                break

        convo = [msg for msg in messages if msg.get("role") not in ("system", "tool")]
        chat_history: List[Dict[str, str]] = []

        message = ""
        for i, item in enumerate(convo):
            is_last = i == len(convo) - 1
            role = item.get("role")
            content = item.get("content", "")

            if is_last and role == "user":
                message = content
                continue

            if role in ("assistant", "user"):
                chat_history.append({
                    "role": "CHATBOT" if role == "assistant" else "USER",
                    "message": content,
                })

        if not message and convo:
            message = convo[-1].get("content", "")

        return message, chat_history, system_prompt

    def _extract_usage(self, response: Dict[str, Any]) -> TokenUsage:
        token_count = response.get("token_count", {})
        meta = response.get("meta", {})
        billed_units = meta.get("billed_units", {})

        prompt_tokens = (
            token_count.get("prompt_tokens")
            or token_count.get("input_tokens")
            or billed_units.get("input_tokens")
            or 0
        )
        completion_tokens = (
            token_count.get("response_tokens")
            or token_count.get("output_tokens")
            or billed_units.get("output_tokens")
            or 0
        )
        total_tokens = token_count.get("total_tokens") or (prompt_tokens + completion_tokens)

        return {
            "inputTokens": prompt_tokens,
            "outputTokens": completion_tokens,
            "totalTokens": total_tokens,
        }

    def _map_finish_reason(self, reason: Optional[str]) -> str:
        if reason == "COMPLETE":
            return "stop"
        if reason == "MAX_TOKENS":
            return "length"
        if reason == "CONTENT_FILTER":
            return "content_filter"
        return "stop"
