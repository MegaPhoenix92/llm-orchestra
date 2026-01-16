# LLM Orchestra

**Unified Observability & Orchestration SDK for Multi-Model AI Applications**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-green.svg)](https://www.python.org/)

---

## The Problem

Building production LLM applications is painful:

- **Multi-model chaos** - Switching between Claude, GPT-4, Gemini requires different SDKs, error handling, and retry logic
- **Blind spots** - No unified view of costs, latency, token usage across providers
- **Debugging nightmares** - Tracing a request through chains, agents, and tool calls is nearly impossible
- **Cost explosions** - No visibility into which prompts/models are eating your budget

## The Solution

**LLM Orchestra** provides a unified layer for orchestrating and observing multi-model AI applications.

```typescript
import { Orchestra } from 'llm-orchestra';

const orchestra = new Orchestra({
  providers: ['anthropic', 'openai', 'google'],
  observability: {
    tracing: true,
    metrics: true,
    costTracking: true
  }
});

// Unified interface - same code, any model
const response = await orchestra.complete({
  model: 'claude-3-opus',  // or 'gpt-4', 'gemini-pro'
  messages: [{ role: 'user', content: 'Hello!' }],
  fallback: ['gpt-4-turbo', 'gemini-pro'],  // Automatic failover
  tags: ['production', 'chat-feature']       // For cost allocation
});

// Full observability out of the box
console.log(response.meta);
// {
//   latency: 1234,
//   tokens: { input: 10, output: 50 },
//   cost: 0.0023,
//   traceId: 'abc-123',
//   model: 'claude-3-opus',
//   provider: 'anthropic'
// }
```

## Key Features

### Unified Multi-Model Interface
- **Single SDK** for Claude, GPT-4, Gemini, Mistral, Llama, and more
- **Automatic failover** with configurable fallback chains
- **Load balancing** across providers and API keys
- **Semantic caching** to reduce costs and latency

### Production-Grade Observability
- **Distributed tracing** - Follow requests through chains, agents, and tools
- **Real-time metrics** - Latency, throughput, error rates per model/prompt
- **Cost tracking** - Per-request, per-feature, per-team cost allocation
- **Prompt versioning** - Track which prompts are deployed where

### Agent Orchestration
- **Multi-agent coordination** - Built-in patterns for agent collaboration
- **Tool call tracing** - See exactly what tools agents used and why
- **Conversation memory** - Pluggable memory backends with observability
- **Workflow engine** - Define complex agent workflows with monitoring

### Developer Experience
- **TypeScript & Python SDKs** - First-class support for both
- **OpenTelemetry native** - Export to any OTEL-compatible backend
- **Self-hosted or cloud** - Run the dashboard locally or use our cloud
- **Framework integrations** - LangChain, LlamaIndex, Vercel AI SDK

## Quick Start

### Installation

```bash
# TypeScript/Node.js
npm install llm-orchestra

# Python
pip install llm-orchestra
```

### Basic Usage

```typescript
import { Orchestra } from 'llm-orchestra';

// Initialize with your API keys
const orchestra = new Orchestra({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    openai: { apiKey: process.env.OPENAI_API_KEY },
  }
});

// Make requests with full observability
const result = await orchestra.complete({
  model: 'claude-3-sonnet',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain quantum computing in simple terms.' }
  ]
});
```

### With Tracing

```typescript
import { Orchestra, trace } from 'llm-orchestra';

// Automatic tracing for complex flows
const result = await trace('user-question-flow', async (span) => {
  // Step 1: Classify intent
  const intent = await orchestra.complete({
    model: 'claude-3-haiku',
    messages: [{ role: 'user', content: userQuestion }],
    tags: ['intent-classification']
  });

  span.addEvent('intent-classified', { intent: intent.content });

  // Step 2: Route to appropriate model
  const response = await orchestra.complete({
    model: intent.content === 'complex' ? 'claude-3-opus' : 'claude-3-sonnet',
    messages: [...],
    tags: ['response-generation']
  });

  return response;
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Application                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                      LLM Orchestra SDK                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Routing   │  │   Caching   │  │   Tracing   │             │
│  │   Engine    │  │   Layer     │  │   Context   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│  ┌──────▼────────────────▼────────────────▼──────┐             │
│  │              Provider Adapters                 │             │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐         │             │
│  │  │Anthropic│ │ OpenAI  │ │ Google  │ • • •   │             │
│  │  └─────────┘ └─────────┘ └─────────┘         │             │
│  └───────────────────────────────────────────────┘             │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                   Observability Backend                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   Traces    │  │   Metrics   │  │    Costs    │             │
│  │   Store     │  │   Store     │  │   Tracker   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## Roadmap

### Phase 1: Core SDK (Q1 2026)
- [x] Unified provider interface (Claude, GPT-4, Gemini)
- [x] Basic tracing and cost tracking
- [x] TypeScript SDK
- [ ] Local dashboard

### Phase 2: Production Features (Q2 2026)
- [ ] Python SDK
- [ ] Semantic caching
- [x] Automatic failover and retries
- [ ] OpenTelemetry export

### Phase 3: Agent Orchestration (Q3 2026)
- [x] Multi-agent coordination primitives
- [ ] Tool call tracing
- [ ] Workflow engine
- [ ] Memory backends

### Phase 4: Enterprise (Q4 2026)
- [ ] Cloud dashboard
- [ ] Team management
- [ ] RBAC and audit logs
- [ ] SOC 2 compliance

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# Clone the repo
git clone https://github.com/MegaPhoenix92/llm-orchestra.git
cd llm-orchestra

# Install dependencies
npm install

# Run tests
npm test

# Start local dashboard
npm run dashboard
```

## Why LLM Orchestra?

### vs. LangSmith
- **Open source** - Self-host, no vendor lock-in
- **Multi-model native** - Not just OpenAI-focused
- **Simpler integration** - Works without LangChain

### vs. Helicone
- **SDK-first** - Not just a proxy, full orchestration
- **Agent support** - Built for multi-agent systems
- **Local-first** - Run everything locally for development

### vs. Building In-House
- **Battle-tested** - Patterns from production systems
- **Time savings** - Months of work, ready to use
- **Community** - Shared learnings and improvements

## About

Built by [TROZLAN](https://trozlan.com) — We're building the future of AI-powered enterprise solutions, including multi-agent orchestration and MCP infrastructure.

LLM Orchestra is born from our experience building production AI systems that coordinate multiple models and agents.

## License

MIT License - See [LICENSE](LICENSE) for details.

---

**Star this repo** if you're interested in better LLM observability!

[Report Bug](https://github.com/MegaPhoenix92/llm-orchestra/issues) · [Request Feature](https://github.com/MegaPhoenix92/llm-orchestra/issues) · [Join Discord](#)
