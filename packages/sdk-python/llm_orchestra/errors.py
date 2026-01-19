from __future__ import annotations

from typing import List, Optional

from .types import ProviderAttempt, ProviderName


class OrchestraError(Exception):
    def __init__(
        self,
        message: str,
        code: str,
        provider: Optional[ProviderName] = None,
        model: Optional[str] = None,
        cause: Optional[Exception] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.provider = provider
        self.model = model
        self.cause = cause


class RateLimitError(OrchestraError):
    def __init__(self, provider: ProviderName, retry_after_ms: Optional[int] = None) -> None:
        super().__init__(f"Rate limit exceeded for {provider}", "RATE_LIMIT", provider)
        self.retry_after_ms = retry_after_ms


class ProviderError(OrchestraError):
    def __init__(self, message: str, provider: ProviderName, status_code: Optional[int] = None) -> None:
        super().__init__(message, "PROVIDER_ERROR", provider)
        self.status_code = status_code


class TimeoutError(OrchestraError):
    def __init__(self, message: str = "Request timed out") -> None:
        super().__init__(message, "TIMEOUT")


class AllProvidersFailedError(OrchestraError):
    def __init__(self, attempts: List[ProviderAttempt]) -> None:
        super().__init__("All providers failed", "ALL_PROVIDERS_FAILED")
        self.attempts = attempts
