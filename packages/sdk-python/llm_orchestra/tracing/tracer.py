from __future__ import annotations

import random
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from ..types import ProviderName, TokenUsage, TracingConfig


class SpanContext:
    def __init__(self, trace_id: str, span_id: str, parent_span_id: Optional[str] = None) -> None:
        self.trace_id = trace_id
        self.span_id = span_id
        self.parent_span_id = parent_span_id


class Span:
    def __init__(
        self,
        tracer: "Tracer",
        name: str,
        context: SpanContext,
        attributes: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.tracer = tracer
        self.name = name
        self.context = context
        self.attributes: Dict[str, Any] = dict(attributes or {})
        self.events: List[Dict[str, Any]] = []
        self.status: Optional[str] = None
        self.start_time = time.time()
        self.end_time: Optional[float] = None

    def set_attributes(self, attrs: Dict[str, Any]) -> None:
        self.attributes.update(attrs)

    def add_event(self, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        self.events.append({"name": name, "attributes": attributes or {}, "time": time.time()})

    def record_exception(self, error: Exception) -> None:
        self.add_event("exception", {"message": str(error), "type": error.__class__.__name__})

    def set_status(self, status: str) -> None:
        self.status = status

    def end(self) -> None:
        if self.end_time is not None:
            return
        self.end_time = time.time()
        self.tracer.record_span(
            {
                "name": self.name,
                "context": {
                    "traceId": self.context.trace_id,
                    "spanId": self.context.span_id,
                    "parentSpanId": self.context.parent_span_id,
                },
                "attributes": dict(self.attributes),
                "events": list(self.events),
                "status": self.status,
                "startTime": self.start_time,
                "endTime": self.end_time,
            }
        )


class Tracer:
    def __init__(self, config: TracingConfig) -> None:
        self.config = config
        self.sample_rate = config.get("sampleRate", 1.0)
        self.spans: List[Dict[str, Any]] = []

    def start_span(
        self,
        name: str,
        attributes: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
        parent_context: Optional[SpanContext] = None,
    ) -> Span:
        trace_value = trace_id or self.generate_trace_id()
        span_id = self.generate_span_id()
        context = SpanContext(trace_value, span_id, parent_context.span_id if parent_context else None)
        return Span(self, name, context, attributes)

    async def trace(
        self,
        name: str,
        fn: Callable[[Span], Awaitable[Any]],
        attributes: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
    ) -> Any:
        span = self.start_span(name, attributes, trace_id=trace_id)
        try:
            result = await fn(span)
            span.set_status("ok")
            return result
        except Exception as exc:
            span.record_exception(exc)
            raise
        finally:
            span.end()

    def record_llm_call(
        self,
        span: Span,
        provider: ProviderName,
        model: str,
        tokens: Optional[TokenUsage] = None,
        cost: Optional[float] = None,
        latency_ms: Optional[float] = None,
        cached: Optional[bool] = None,
    ) -> None:
        span.set_attributes(
            {
                "llm.provider": provider,
                "llm.model": model,
                "llm.tokens.input": tokens.get("inputTokens") if tokens else None,
                "llm.tokens.output": tokens.get("outputTokens") if tokens else None,
                "llm.tokens.total": tokens.get("totalTokens") if tokens else None,
                "llm.cost": cost,
                "llm.latency_ms": latency_ms,
                "llm.cached": cached,
            }
        )

    def record_span(self, data: Dict[str, Any]) -> None:
        if not self._should_sample():
            return
        self.spans.append(data)

    def get_spans(self) -> List[Dict[str, Any]]:
        return list(self.spans)

    def clear_spans(self) -> None:
        self.spans = []

    def generate_trace_id(self) -> str:
        return f"trace_{int(time.time() * 1000)}_{random.randint(100000, 999999)}"

    def generate_span_id(self) -> str:
        return f"span_{int(time.time() * 1000)}_{random.randint(100000, 999999)}"

    async def flush(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    def _should_sample(self) -> bool:
        return random.random() <= self.sample_rate


class NoopSpan:
    def set_attributes(self, attrs: Dict[str, Any]) -> None:
        return None

    def add_event(self, name: str, attributes: Optional[Dict[str, Any]] = None) -> None:
        return None

    def record_exception(self, error: Exception) -> None:
        return None

    def set_status(self, status: str) -> None:
        return None

    def end(self) -> None:
        return None


class NoopTracer(Tracer):
    def __init__(self) -> None:
        super().__init__({"enabled": False})

    def start_span(
        self,
        name: str,
        attributes: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
        parent_context: Optional[SpanContext] = None,
    ) -> NoopSpan:
        return NoopSpan()

    async def trace(
        self,
        name: str,
        fn: Callable[[Any], Awaitable[Any]],
        attributes: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
    ) -> Any:
        return await fn(NoopSpan())

    def record_llm_call(
        self,
        span: Any,
        provider: ProviderName,
        model: str,
        tokens: Optional[TokenUsage] = None,
        cost: Optional[float] = None,
        latency_ms: Optional[float] = None,
        cached: Optional[bool] = None,
    ) -> None:
        return None

    def record_span(self, data: Dict[str, Any]) -> None:
        return None

    def get_spans(self) -> List[Dict[str, Any]]:
        return []

    def clear_spans(self) -> None:
        return None

    def generate_trace_id(self) -> str:
        return f"trace_{int(time.time() * 1000)}"

    def generate_span_id(self) -> str:
        return f"span_{int(time.time() * 1000)}"


def create_noop_tracer() -> NoopTracer:
    return NoopTracer()
