# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-01-19

### Added

- **Providers**
  - Mistral (REST + streaming)
  - Cohere (chat completions)
  - Azure OpenAI (deployment-based REST + streaming)
- **Observability**
  - OTLP/HTTP trace export for OpenTelemetry backends
  - Tool call tracing events (tool calls + tool results)
- **Workflow & Memory**
  - Workflow engine with step routing, error handling, and tracing hooks
  - In-memory conversation memory backend with TTL + max item pruning
- **Developer Experience**
  - Streaming usage example
  - API docs pipeline via TypeDoc + GitHub Pages
- **Dashboard**
  - View updates and CLI refinements (stats, traces, costs, health)

## [0.1.0] - 2026-01-18

### Added

- **Core SDK**
  - Unified interface for Claude, GPT-4, and Gemini models
  - Automatic failover between providers with configurable retry logic
  - Distributed tracing with OpenTelemetry-compatible spans
  - Cost tracking with alert thresholds and budget limits
  - Request caching with semantic similarity matching
  - Tool/function calling support across providers

- **Dashboard Package** (`llm-orchestra-dashboard`)
  - Local observability dashboard with web UI
  - Real-time request feed via Server-Sent Events
  - Trace viewer with span hierarchy visualization
  - Cost breakdown by provider and model
  - Provider health monitoring
  - CLI commands: `stats`, `traces`, `costs`, `health`

- **Developer Experience**
  - Comprehensive usage examples
  - TypeScript-first with full type definitions
  - ESM-only package with subpath exports
  - GitHub Actions CI/CD workflows
  - 400+ tests with 92%+ coverage

### Providers

| Provider | Models | Features |
|----------|--------|----------|
| Anthropic | Claude 3 Opus, Sonnet, Haiku | Streaming, Tools |
| OpenAI | GPT-4, GPT-3.5-Turbo | Streaming, Tools |
| Google | Gemini 1.5 Pro, Flash | Streaming, Tools |

[Unreleased]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/MegaPhoenix92/llm-orchestra/releases/tag/v0.1.0
