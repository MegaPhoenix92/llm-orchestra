from __future__ import annotations

import time

from ..types import (
    CompletionRequest,
    CompletionResponse,
    CompletionStream,
    ProviderCredentials,
    ProviderName,
    StreamChunk,
    TokenUsage,
)


class BaseProvider:
    name: ProviderName

    def __init__(self, credentials: ProviderCredentials) -> None:
        self.credentials = credentials

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        raise NotImplementedError

    async def stream(self, request: CompletionRequest) -> CompletionStream:
        response = await self.complete(request)

        if response.get("content"):
            yield {"content": response["content"]}

        if response.get("toolCalls"):
            yield {"toolCalls": response["toolCalls"]}

        yield {
            "finishReason": response.get("finishReason", "stop"),
            "meta": response.get("meta", {}),
        }

    async def list_models(self) -> list[str]:
        return []

    async def is_available(self) -> bool:
        try:
            await self.list_models()
            return True
        except Exception:
            return False

    def get_model_cost(self, model: str) -> dict[str, float]:
        return {"inputPer1k": 0.0, "outputPer1k": 0.0}

    def calculate_cost(self, model: str, usage: TokenUsage) -> float:
        pricing = self.get_model_cost(model)
        input_cost = (usage.get("inputTokens", 0) / 1000) * pricing["inputPer1k"]
        output_cost = (usage.get("outputTokens", 0) / 1000) * pricing["outputPer1k"]
        return round(input_cost + output_cost, 6)

    def generate_span_id(self) -> str:
        return f"span_{int(time.time() * 1000)}_{int(time.time_ns() % 100000)}"
