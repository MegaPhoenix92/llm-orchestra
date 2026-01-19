from __future__ import annotations

import copy
import time
from typing import Any, Dict, List, Optional

from .cache.semantic_cache import SemanticCache
from .providers import create_providers, get_provider_for_model
from .routing.router import Router
from .tracing.tracer import Tracer, create_noop_tracer
from .types import (
    CompletionMeta,
    CompletionRequest,
    CompletionResponse,
    CompletionStream,
    OrchestraConfig,
    ProviderName,
    TokenUsage,
)


class Orchestra:
    def __init__(self, config: OrchestraConfig) -> None:
        self.config = config
        self.providers = create_providers(config.get("providers", {}))
        self.router = Router(
            providers=self.providers,
            retry=config.get("retry"),
            default_timeout=config.get("defaultTimeout"),
        )
        tracing_config = config.get("observability", {}).get("tracing")
        self.tracer = Tracer(tracing_config) if tracing_config and tracing_config.get("enabled") else create_noop_tracer()
        self.cache = SemanticCache(config["cache"]) if config.get("cache", {}).get("enabled") else None
        self.stats = self._init_stats()

    async def complete(self, request: CompletionRequest) -> CompletionResponse:
        trace_id = self.tracer.generate_trace_id()
        start_time = time.time()
        cache_enabled = bool(self.cache) and request.get("cache", True) is not False

        async def run(span) -> CompletionResponse:
            span.set_attributes(
                {
                    "orchestra.model": request.get("model"),
                    "orchestra.fallback": ",".join(request.get("fallback", []) or []),
                    "orchestra.tags": ",".join(request.get("tags", []) or []),
                }
            )

            if cache_enabled and self.cache:
                cached = await self.cache.get(request)
                if cached:
                    response = self._build_cached_response(
                        cached,
                        trace_id,
                        (time.time() - start_time) * 1000,
                    )
                    self.tracer.record_llm_call(
                        span,
                        provider=response["meta"]["provider"],
                        model=response["meta"]["model"],
                        tokens=response["meta"]["tokens"],
                        cost=response["meta"]["cost"],
                        latency_ms=response["meta"]["latencyMs"],
                        cached=response["meta"]["cached"],
                    )
                    self._update_stats(response["meta"])
                    if self.config.get("observability", {}).get("costTracking", {}).get("enabled"):
                        self._check_cost_alerts(response["meta"]["cost"])
                    return response

            result = await self.router.route(request)
            response = result["response"]
            response["meta"]["traceId"] = trace_id

            self.tracer.record_llm_call(
                span,
                provider=response["meta"]["provider"],
                model=response["meta"]["model"],
                tokens=response["meta"]["tokens"],
                cost=response["meta"]["cost"],
                latency_ms=response["meta"]["latencyMs"],
                cached=response["meta"]["cached"],
            )
            self._update_stats(response["meta"])

            if self.config.get("observability", {}).get("costTracking", {}).get("enabled"):
                self._check_cost_alerts(response["meta"]["cost"])

            if cache_enabled and self.cache:
                await self.cache.set(request, response)

            return response

        return await self.tracer.trace(
            "orchestra.complete",
            run,
            {"orchestra.trace_id": trace_id},
            trace_id=trace_id,
        )

    async def stream(self, request: CompletionRequest) -> CompletionStream:
        trace_id = self.tracer.generate_trace_id()
        start_time = time.time()
        cache_enabled = bool(self.cache) and request.get("cache", True) is not False

        span = self.tracer.start_span(
            "orchestra.stream",
            {"orchestra.model": request.get("model"), "orchestra.trace_id": trace_id},
            trace_id=trace_id,
        )

        if cache_enabled and self.cache:
            cached = await self.cache.get(request)
            if cached:
                response = self._build_cached_response(
                    cached,
                    trace_id,
                    (time.time() - start_time) * 1000,
                )
                self.tracer.record_llm_call(
                    span,
                    provider=response["meta"]["provider"],
                    model=response["meta"]["model"],
                    tokens=response["meta"]["tokens"],
                    cost=response["meta"]["cost"],
                    latency_ms=response["meta"]["latencyMs"],
                    cached=response["meta"]["cached"],
                )
                self._update_stats(response["meta"])
                if self.config.get("observability", {}).get("costTracking", {}).get("enabled"):
                    self._check_cost_alerts(response["meta"]["cost"])

                if response.get("content"):
                    yield {"content": response["content"]}
                if response.get("toolCalls"):
                    yield {"toolCalls": response["toolCalls"]}
                yield {"finishReason": response.get("finishReason", "stop"), "meta": response["meta"]}

                span.set_status("ok")
                span.end()
                return

        final_meta: Optional[CompletionMeta] = None
        try:
            async for chunk in self.router.route_stream(request):
                if chunk.get("meta"):
                    meta = chunk["meta"]
                    if meta.get("provider") and meta.get("model"):
                        self.tracer.record_llm_call(
                            span,
                            provider=meta["provider"],
                            model=meta["model"],
                            tokens=meta.get("tokens"),
                            cost=meta.get("cost"),
                            latency_ms=meta.get("latencyMs"),
                            cached=meta.get("cached"),
                        )
                    if (
                        meta.get("provider")
                        and meta.get("model")
                        and meta.get("tokens")
                        and meta.get("cost") is not None
                        and meta.get("latencyMs") is not None
                    ):
                        final_meta = {
                            "provider": meta["provider"],
                            "model": meta["model"],
                            "tokens": meta["tokens"],
                            "cost": meta["cost"],
                            "latencyMs": meta["latencyMs"],
                        }
                yield chunk

            if final_meta:
                self._update_stats(final_meta)
                if self.config.get("observability", {}).get("costTracking", {}).get("enabled"):
                    self._check_cost_alerts(final_meta["cost"])

            span.set_status("ok")
        except Exception as exc:
            span.record_exception(exc)
            raise
        finally:
            span.end()

    def get_providers(self) -> List[ProviderName]:
        return list(self.providers.keys())

    async def is_provider_available(self, provider: ProviderName) -> bool:
        adapter = self.providers.get(provider)
        if not adapter:
            return False
        return await adapter.is_available()

    def get_provider_for_model(self, model: str) -> Optional[ProviderName]:
        return get_provider_for_model(model)

    async def list_models(self, provider: ProviderName) -> List[str]:
        adapter = self.providers.get(provider)
        if not adapter:
            return []
        return await adapter.list_models()

    def get_model_cost(self, model: str) -> Optional[Dict[str, float]]:
        provider = get_provider_for_model(model)
        if not provider:
            return None
        adapter = self.providers.get(provider)
        if not adapter:
            return None
        return adapter.get_model_cost(model)

    def get_stats(self) -> Dict[str, Any]:
        return copy.deepcopy(self.stats)

    def reset_stats(self) -> None:
        self.stats = self._init_stats()

    def get_traces(self) -> List[Dict[str, Any]]:
        return self.tracer.get_spans()

    async def flush_traces(self) -> None:
        await self.tracer.flush()

    async def shutdown(self) -> None:
        await self.tracer.shutdown()

    def _init_stats(self) -> Dict[str, Any]:
        return {
            "totalRequests": 0,
            "totalTokens": {"input": 0, "output": 0},
            "totalCost": 0,
            "byProvider": {},
            "byModel": {},
        }

    def _update_stats(self, meta: CompletionMeta) -> None:
        provider = meta["provider"]
        model = meta["model"]
        tokens = meta["tokens"]
        cost = meta["cost"]
        latency_ms = meta["latencyMs"]

        self.stats["totalRequests"] += 1
        self.stats["totalTokens"]["input"] += tokens.get("inputTokens", 0)
        self.stats["totalTokens"]["output"] += tokens.get("outputTokens", 0)
        self.stats["totalCost"] += cost

        if provider not in self.stats["byProvider"]:
            self.stats["byProvider"][provider] = {
                "requests": 0,
                "tokens": {"input": 0, "output": 0},
                "cost": 0,
                "avgLatencyMs": 0,
            }

        provider_stats = self.stats["byProvider"][provider]
        prev_avg = provider_stats["avgLatencyMs"]
        prev_count = provider_stats["requests"]
        provider_stats["requests"] += 1
        provider_stats["tokens"]["input"] += tokens.get("inputTokens", 0)
        provider_stats["tokens"]["output"] += tokens.get("outputTokens", 0)
        provider_stats["cost"] += cost
        provider_stats["avgLatencyMs"] = (
            (prev_avg * prev_count + latency_ms) / provider_stats["requests"]
        )

        if model not in self.stats["byModel"]:
            self.stats["byModel"][model] = {
                "requests": 0,
                "tokens": {"input": 0, "output": 0},
                "cost": 0,
            }

        model_stats = self.stats["byModel"][model]
        model_stats["requests"] += 1
        model_stats["tokens"]["input"] += tokens.get("inputTokens", 0)
        model_stats["tokens"]["output"] += tokens.get("outputTokens", 0)
        model_stats["cost"] += cost

    def _check_cost_alerts(self, cost: float) -> None:
        config = self.config.get("observability", {}).get("costTracking", {})
        if not config:
            return

        if config.get("alertThreshold") and self.stats["totalCost"] >= config["alertThreshold"]:
            print(
                f"[Orchestra] Cost alert: Total cost ${self.stats['totalCost']:.4f} exceeds threshold "
                f"${config['alertThreshold']}"
            )

        if config.get("budgetLimit") and self.stats["totalCost"] >= config["budgetLimit"]:
            print(
                f"[Orchestra] Budget exceeded: Total cost ${self.stats['totalCost']:.4f} exceeds limit "
                f"${config['budgetLimit']}"
            )

    def _build_cached_response(
        self,
        response: CompletionResponse,
        trace_id: str,
        latency_ms: float,
    ) -> CompletionResponse:
        tokens: TokenUsage = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}

        return {
            "content": response.get("content", ""),
            "toolCalls": response.get("toolCalls"),
            "finishReason": response.get("finishReason", "stop"),
            "meta": {
                **response.get("meta", {}),
                "traceId": trace_id,
                "spanId": self._generate_span_id(),
                "latencyMs": latency_ms,
                "tokens": tokens,
                "cost": 0,
                "cached": True,
                "failoverAttempts": 0,
            },
        }

    def _generate_span_id(self) -> str:
        return f"span_{int(time.time() * 1000)}_{int(time.time_ns() % 100000)}"


def create_orchestra(config: Dict[str, Any]) -> Orchestra:
    return Orchestra(config)
