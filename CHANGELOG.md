# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-01-18

### Added

- **Core SDK**
  - Unified interface for Claude, GPT-4, and Gemini models
  - Automatic failover between providers with configurable retry logic
  - Distributed tracing with OpenTelemetry-compatible spans
  - Cost tracking with alert thresholds and budget limits
  - Request caching with semantic similarity matching
  - Tool/function calling support across providers

- **Dashboard Package** (`@llm-orchestra/dashboard`)
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

[Unreleased]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MegaPhoenix92/llm-orchestra/releases/tag/v0.1.0
