from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Tuple

from ..errors import AllProvidersFailedError, TimeoutError
from ..providers import get_provider_for_model
from ..types import CompletionRequest, CompletionResponse, ProviderName, RetryConfig

DEFAULT_RETRY_CONFIG: RetryConfig = {
    "maxRetries": 3,
    "initialDelayMs": 1000,
    "maxDelayMs": 30000,
    "backoffMultiplier": 2,
    "retryableErrors": ["RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR", "503", "529"],
}


class Router:
    def __init__(
        self,
        providers: Dict[ProviderName, Any],
        retry: Dict[str, Any] | None = None,
        default_timeout: int | None = None,
    ) -> None:
        self.providers = providers
        self.retry_config = {**DEFAULT_RETRY_CONFIG, **(retry or {})}
        self.default_timeout = default_timeout or 60000

    async def route(self, request: CompletionRequest) -> Dict[str, Any]:
        models = self._build_model_chain(request)
        attempts: List[Dict[str, Any]] = []

        for model, provider in models:
            adapter = self.providers.get(provider)
            if not adapter:
                attempts.append(
                    {
                        "provider": provider,
                        "model": model,
                        "success": False,
                        "error": Exception(f"Provider {provider} not configured"),
                        "latencyMs": 0,
                    }
                )
                continue

            for retry_idx in range(self.retry_config["maxRetries"] + 1):
                start_time = time.time()
                try:
                    response = await self._execute_with_timeout(
                        adapter.complete({**request, "model": model}),
                        request.get("timeout", self.default_timeout),
                    )
                    response["meta"]["failoverAttempts"] = len(attempts)
                    attempts.append(
                        {
                            "provider": provider,
                            "model": model,
                            "success": True,
                            "latencyMs": (time.time() - start_time) * 1000,
                        }
                    )
                    return {"response": response, "attempts": attempts}
                except Exception as exc:
                    latency_ms = (time.time() - start_time) * 1000
                    attempts.append(
                        {
                            "provider": provider,
                            "model": model,
                            "success": False,
                            "error": exc,
                            "latencyMs": latency_ms,
                        }
                    )

                    if not self._is_retryable(exc) or retry_idx == self.retry_config["maxRetries"]:
                        break

                    delay = min(
                        self.retry_config["initialDelayMs"]
                        * (self.retry_config["backoffMultiplier"] ** retry_idx),
                        self.retry_config["maxDelayMs"],
                    )
                    await asyncio.sleep(delay / 1000)

        raise AllProvidersFailedError(attempts)

    async def route_stream(self, request: CompletionRequest):
        models = self._build_model_chain(request)
        attempts: List[Dict[str, Any]] = []

        for model, provider in models:
            adapter = self.providers.get(provider)
            if not adapter:
                continue

            start_time = time.time()
            try:
                async for chunk in adapter.stream({**request, "model": model}):
                    if chunk.get("meta"):
                        chunk["meta"]["failoverAttempts"] = len(attempts)
                    yield chunk
                return
            except Exception as exc:
                attempts.append(
                    {
                        "provider": provider,
                        "model": model,
                        "success": False,
                        "error": exc,
                        "latencyMs": (time.time() - start_time) * 1000,
                    }
                )
                continue

        raise AllProvidersFailedError(attempts)

    def _build_model_chain(self, request: CompletionRequest) -> List[Tuple[str, ProviderName]]:
        chain: List[Tuple[str, ProviderName]] = []
        model = request.get("model")
        if model:
            provider = get_provider_for_model(model)
            if provider:
                chain.append((model, provider))

        for fallback_model in request.get("fallback", []) or []:
            provider = get_provider_for_model(fallback_model)
            if provider:
                chain.append((fallback_model, provider))

        return chain

    async def _execute_with_timeout(self, coro, timeout_ms: int) -> CompletionResponse:
        try:
            return await asyncio.wait_for(coro, timeout_ms / 1000)
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"Request timed out after {timeout_ms}ms") from exc

    def _is_retryable(self, error: Exception) -> bool:
        raw_code = getattr(error, "code", None)
        raw_status = getattr(error, "status", None) or getattr(error, "status_code", None)
        error_code = str(raw_code) if raw_code is not None else ""
        error_status = str(raw_status) if raw_status is not None else ""
        return error_code in self.retry_config["retryableErrors"] or error_status in self.retry_config[
            "retryableErrors"
        ]
