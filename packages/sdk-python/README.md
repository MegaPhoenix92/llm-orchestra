# LLM Orchestra Python SDK

Python SDK for LLM Orchestra, providing unified routing, caching, and observability
across multiple LLM providers.

## Install

```bash
pip install llm-orchestra

# Install with specific provider support
pip install "llm-orchestra[openai]"
pip install "llm-orchestra[anthropic]"
pip install "llm-orchestra[google]"
pip install "llm-orchestra[mistral]"
pip install "llm-orchestra[cohere]"
pip install "llm-orchestra[azure-openai]"

# Install all providers
pip install "llm-orchestra[all]"
```

## Supported Providers

| Provider | Models | Install |
|----------|--------|---------|
| Anthropic | Claude 3 Opus, Sonnet, Haiku | `[anthropic]` |
| OpenAI | GPT-4, GPT-3.5-Turbo | `[openai]` |
| Google | Gemini 1.5 Pro, Flash | `[google]` |
| Mistral | Mistral Large, Medium, Small | `[mistral]` |
| Cohere | Command, Command-R | `[cohere]` |
| Azure OpenAI | Deployment-based | `[azure-openai]` |

## Quick Start

```python
import asyncio
from llm_orchestra import Orchestra

async def main() -> None:
    orchestra = Orchestra({
        "providers": {
            "anthropic": {"apiKey": "YOUR_KEY"}
        }
    })

    response = await orchestra.complete({
        "model": "claude-3-sonnet",
        "messages": [{"role": "user", "content": "Hello"}]
    })

    print(response["content"])

asyncio.run(main())
```

## Multi-Provider Configuration

```python
from llm_orchestra import Orchestra

orchestra = Orchestra({
    "providers": {
        "anthropic": {"apiKey": "sk-ant-..."},
        "openai": {"apiKey": "sk-..."},
        "google": {"apiKey": "..."},
        "mistral": {"apiKey": "..."},
        "cohere": {"apiKey": "..."},
        "azure_openai": {
            "apiKey": "...",
            "baseUrl": "https://your-resource.openai.azure.com",
            "apiVersion": "2024-02-15-preview"  # optional
        }
    }
})
```

## Azure OpenAI

Azure OpenAI uses deployment-based routing. Prefix your model name with `azure-openai:` or `azure:`:

```python
response = await orchestra.complete({
    "model": "azure-openai:my-gpt4-deployment",
    "messages": [{"role": "user", "content": "Hello"}]
})
```
