# LLM Orchestra Python SDK

Python SDK for LLM Orchestra, providing unified routing, caching, and observability
across multiple LLM providers.

## Install

```bash
pip install llm-orchestra
```

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
