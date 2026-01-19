from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List

from .base import BaseProvider
from ..types import CompletionRequest, CompletionResponse, Message, TokenUsage

# Pricing as of Jan 2026 (per 1K tokens)
MODEL_PRICING: Dict[str, Dict[str, float]] = {
    "gemini-1.5-pro": {"inputPer1k": 0.00125, "outputPer1k": 0.005},
    "gemini-1.5-flash": {"inputPer1k": 0.00035, "outputPer1k": 0.00105},
    "gemini-2.0-flash": {"inputPer1k": 0.0003, "outputPer1k": 0.001},
    "gemini-pro": {"inputPer1k": 0.0005, "outputPer1k": 0.0015},
}


class GoogleProvider(BaseProvider):
    name = "google"

    def __init__(self, credentials: Dict[str, Any]) -> None:
        super().__init__(credentials)
        try:
            import google.generativeai as genai
        except ImportError as exc:
            raise ImportError(
                "GoogleProvider requires google-generativeai. Install with `pip install llm-orchestra[google]`."
            ) from exc

        genai.configure(api_key=credentials.get("apiKey"))
        self.genai = genai

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        start_time = time.time()
        span_id = self.generate_span_id()
        model_name = request.get("model", "")

        model = self.genai.GenerativeModel(model_name)
        prompt = self._convert_messages(request.get("messages", []))

        response = await asyncio.to_thread(model.generate_content, prompt)
        latency_ms = (time.time() - start_time) * 1000

        usage: TokenUsage = {
            "inputTokens": 0,
            "outputTokens": 0,
            "totalTokens": 0,
        }

        return {
            "content": getattr(response, "text", "") or "",
            "finishReason": "stop",
            "meta": {
                "latencyMs": latency_ms,
                "tokens": usage,
                "cost": self.calculate_cost(model_name, usage),
                "traceId": "",
                "spanId": span_id,
                "model": model_name,
                "provider": "google",
                "cached": False,
                "failoverAttempts": 0,
            },
        }

    async def list_models(self) -> list[str]:
        response = await asyncio.to_thread(self.genai.list_models)
        return [model.name for model in response]

    def get_model_cost(self, model: str) -> dict[str, float]:
        return MODEL_PRICING.get(model, {"inputPer1k": 0.0005, "outputPer1k": 0.0015})

    def _convert_messages(self, messages: List[Message]) -> str:
        segments: List[str] = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            segments.append(f"{role}: {content}")
        return "\n".join(segments)
