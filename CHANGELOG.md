# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-01-22

### Documentation

- Add links to GitHub dependency graph, Dependabot alerts, and Dependency Review docs

## [0.5.0] - 2026-01-22

### Added

- **Alerting & Webhooks**
  - Project-level alert rules for cost thresholds and error rates
  - Alert event history with cooldown windows
  - Webhook deliveries with HMAC signing, retries, and backoff
  - Admin APIs for alert rules, events, webhooks, and delivery attempts

- **Framework Integrations**
  - Vercel AI SDK helper module (`toVercelStream`, `toVercelStreamWithData`, `collectStream`)
  - LangChain integration module (`OrchestraChatModel`, `toOrchestraMessages`, `toOrchestraTools`)
  - LCEL-compatible chat model wrapper for LangChain pipelines
  - Streaming, tool binding, and piping support in LangChain wrapper
  - Comprehensive integration guides with copy-paste Next.js routes
  - 30 new tests for integration modules

- **Developer Experience**
  - Docker Compose setup for local PostgreSQL development
  - Updated documentation with Docker commands and environment variables

## [0.4.0] - 2026-01-21

### Added

- **Security Scanning** (#65)
  - CodeQL static analysis for JavaScript/TypeScript vulnerabilities
  - Dependency scanning with `npm audit` and Dependabot
  - Secret detection to prevent credential leaks
  - Automated security checks in CI pipeline

- **Azure AD SSO/OIDC Integration** (#66)
  - Enterprise single sign-on via Azure Active Directory
  - OIDC-compliant authentication flow
  - Automatic user provisioning on first login
  - Support for Azure AD groups and roles
  - Environment variables: `SSO_ISSUER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_REDIRECT_URI`

- **Encryption at Rest** (#67, #68, #69)
  - AES-256-GCM field-level encryption for sensitive data
  - PBKDF2 key derivation with 100,000 iterations
  - Protected fields: user emails/names, invitation tokens, audit log IPs/user agents
  - Deterministic email hashing for encrypted lookups
  - v2 encryption format with key ID for rotation support

- **Encryption CLI Commands**
  - `encrypt status` - Show encryption coverage report with v1/v2 format distribution
  - `encrypt migrate` - Backfill encryption for existing unencrypted data
  - `encrypt validate` - Verify all encrypted data can be decrypted
  - `encrypt rotate` - Re-encrypt all data with a new key for key rotation
  - Dry-run mode and verbose output for all commands
  - Environment variable support: `ENCRYPTION_MASTER_KEY`, `OLD_ENCRYPTION_KEY`, `NEW_ENCRYPTION_KEY`

- **Key Rotation Support**
  - v2 encryption format: `v2:<keyId>:<salt>:<iv>:<authTag>:<ciphertext>`
  - Multi-key configuration with `previousKeys` for transition periods
  - Backward compatibility with v1 encrypted data
  - Automatic key selection during decryption

- **Documentation**
  - Comprehensive encryption-at-rest guide with threat model
  - Production deployment checklist
  - Key rotation procedures and best practices

### Security

- All sensitive fields now encrypted by default when `ENCRYPTION_MASTER_KEY` is set
- Audit logs protect IP addresses and user agents
- Invitation tokens encrypted to prevent exposure
- Key rotation enables regular security hygiene without downtime

## [0.3.0] - 2026-01-19

### Added

- **Cloud Dashboard**
  - Multi-tenant cloud deployment support with PostgreSQL storage
  - Organization and project management for data isolation
  - JWT authentication for web dashboard users
  - API key authentication for SDK ingestion
  - OTLP-compatible `/api/v1/ingest` endpoint
  - Rate limiting per API key
  - Team management with role-based access (owner, admin, member, viewer)

- **Database Layer**
  - Drizzle ORM integration with PostgreSQL
  - Migration system with `drizzle-kit`
  - Schema: organizations, projects, users, api_keys, sessions, traces, spans, span_events

- **Authentication**
  - User registration with organization creation
  - Login/logout with JWT access and refresh tokens
  - Password hashing with bcrypt
  - API key generation with SHA-256 hashing and `orch_` prefix

- **CLI Cloud Support**
  - Global `--api-key` and `--project-id` options
  - Environment variable support: `ORCHESTRA_API_KEY`, `ORCHESTRA_PROJECT_ID`, `ORCHESTRA_SERVER`
  - Automatic validation of cloud mode requirements

- **Testing**
  - Comprehensive integration tests for auth, API keys, ingestion, and rate limiting
  - 543+ tests with full cloud flow coverage

### Changed

- CLI commands now use shared `ApiOptions` interface for consistent configuration
- URL building preserves base path for reverse proxy deployments

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

[Unreleased]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MegaPhoenix92/llm-orchestra/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/MegaPhoenix92/llm-orchestra/releases/tag/v0.1.0
