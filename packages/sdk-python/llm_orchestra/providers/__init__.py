from __future__ import annotations

from typing import Dict

from .base import BaseProvider
from .anthropic_provider import AnthropicProvider
from .openai_provider import OpenAIProvider
from .google_provider import GoogleProvider
from .mistral_provider import MistralProvider
from .cohere_provider import CohereProvider
from .azure_openai_provider import AzureOpenAIProvider
from ..types import ProviderName, ProvidersConfig

MODEL_PROVIDER_MAP: Dict[str, ProviderName] = {
    # Anthropic
    "claude-3-opus": "anthropic",
    "claude-3-sonnet": "anthropic",
    "claude-3-haiku": "anthropic",
    "claude-3.5-sonnet": "anthropic",
    "claude-3.5-haiku": "anthropic",
    "claude-3-opus-20240229": "anthropic",
    "claude-3-sonnet-20240229": "anthropic",
    "claude-3-haiku-20240307": "anthropic",
    "claude-3-5-sonnet-20241022": "anthropic",
    "claude-3-5-haiku-20241022": "anthropic",
    # OpenAI
    "gpt-4": "openai",
    "gpt-4-turbo": "openai",
    "gpt-4-turbo-preview": "openai",
    "gpt-4o": "openai",
    "gpt-4o-mini": "openai",
    "gpt-3.5-turbo": "openai",
    "gpt-3.5-turbo-16k": "openai",
    # Google
    "gemini-pro": "google",
    "gemini-pro-vision": "google",
    "gemini-1.5-pro": "google",
    "gemini-1.5-flash": "google",
    "gemini-2.0-flash": "google",
    # Mistral
    "mistral-large": "mistral",
    "mistral-medium": "mistral",
    "mistral-small": "mistral",
    "mistral-large-latest": "mistral",
    "mistral-small-latest": "mistral",
    # Cohere
    "command": "cohere",
    "command-light": "cohere",
    "command-r": "cohere",
    "command-r-plus": "cohere",
}


def create_providers(config: ProvidersConfig) -> Dict[ProviderName, BaseProvider]:
    providers: Dict[ProviderName, BaseProvider] = {}

    anthropic = config.get("anthropic")
    if anthropic and anthropic.get("apiKey"):
        providers["anthropic"] = AnthropicProvider(anthropic)

    openai = config.get("openai")
    if openai and openai.get("apiKey"):
        providers["openai"] = OpenAIProvider(openai)

    google = config.get("google")
    if google and google.get("apiKey"):
        providers["google"] = GoogleProvider(google)

    mistral = config.get("mistral")
    if mistral and mistral.get("apiKey"):
        providers["mistral"] = MistralProvider(mistral)

    cohere = config.get("cohere")
    if cohere and cohere.get("apiKey"):
        providers["cohere"] = CohereProvider(cohere)

    azure_openai = config.get("azure_openai")
    if azure_openai and azure_openai.get("apiKey") and azure_openai.get("baseUrl"):
        providers["azure-openai"] = AzureOpenAIProvider(azure_openai)

    return providers


def get_provider_for_model(model: str) -> ProviderName | None:
    if model in MODEL_PROVIDER_MAP:
        return MODEL_PROVIDER_MAP[model]

    if model.startswith("claude"):
        return "anthropic"
    if model.startswith("gpt"):
        return "openai"
    if model.startswith("gemini"):
        return "google"
    if model.startswith("mistral"):
        return "mistral"
    if model.startswith("command"):
        return "cohere"
    if model.startswith("azure-openai:") or model.startswith("azure:"):
        return "azure-openai"

    return None


def get_models_for_provider(provider: ProviderName) -> list[str]:
    return [model for model, prov in MODEL_PROVIDER_MAP.items() if prov == provider]


__all__ = [
    "BaseProvider",
    "AnthropicProvider",
    "OpenAIProvider",
    "GoogleProvider",
    "MistralProvider",
    "CohereProvider",
    "AzureOpenAIProvider",
    "create_providers",
    "get_provider_for_model",
    "get_models_for_provider",
]
