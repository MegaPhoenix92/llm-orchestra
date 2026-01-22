# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email security concerns to: security@trozlan.io
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 7 days
  - Medium: 30 days
  - Low: 90 days

### Scope

The following are in scope:
- `llm-orchestra` npm package
- `llm-orchestra-dashboard` npm package
- API key handling and storage
- Data transmission security
- Dependency vulnerabilities

### Out of Scope

- Third-party provider APIs (Anthropic, OpenAI, Google)
- User application code using this SDK
- Social engineering attacks

## Security Best Practices

When using LLM Orchestra:

### API Key Management

```typescript
// ✅ Good: Use environment variables
const orchestra = new Orchestra({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});

// ❌ Bad: Hardcoded keys
const orchestra = new Orchestra({
  providers: {
    anthropic: { apiKey: 'sk-ant-...' },
  },
});
```

### Prompt Security

- Never include sensitive data in prompts without proper handling
- Use `includePrompts: false` in tracing config for production
- Implement input validation before sending to LLM

### Dashboard Security

- The dashboard is intended for local development only
- Do not expose the dashboard port to the public internet
- Use proper authentication if deploying in shared environments

### Encryption at Rest (Cloud)

Sensitive fields in the cloud dashboard can be encrypted at rest. See
`docs/encryption-at-rest.md` for guarantees, threat model, and operational guidance.

### Repository Security

- [Dependency graph](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-the-dependency-graph)
  and [Dependabot alerts](https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts)
  monitor dependency vulnerabilities
- [Dependency Review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review)
  runs on pull requests to flag risky updates

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who report valid vulnerabilities.
