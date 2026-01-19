# Contributing to LLM Orchestra

Thank you for your interest in contributing to LLM Orchestra! This document provides guidelines and information for contributors.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

## Security Issues

Please do not open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the preferred disclosure process.

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Use the bug report template
3. Include reproduction steps, expected vs actual behavior
4. Add relevant logs, screenshots, or code snippets

### Suggesting Features

1. Check existing feature requests
2. Use the feature request template
3. Explain the use case and benefits
4. Consider implementation complexity

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Make your changes
4. Write/update tests
5. Run the test suite (`npm test`)
6. Run lint/typecheck (`npm run lint`, `npm run typecheck`)
7. Commit with conventional commits (`feat: add amazing feature`)
8. Push to your fork
9. Open a Pull Request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/llm-orchestra.git
cd llm-orchestra

# Install dependencies
npm install

# Run tests
npm test

# Run in development mode
npm run dev
```

## Project Structure

```
llm-orchestra/
├── packages/
│   ├── sdk-python/     # Python SDK
│   └── dashboard/      # Web dashboard
├── src/                # TypeScript SDK + core orchestration logic
├── examples/           # Example applications
└── tests/              # Integration tests
```

## Coding Standards

- **TypeScript**: Follow the existing style, use strict mode
- **Python**: Follow PEP 8, use type hints
- **Testing**: Maintain >80% coverage for new code
- **Documentation**: Update docs for any API changes

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Formatting, no code change
- `refactor:` Code change without feat/fix
- `test:` Adding tests
- `chore:` Maintenance tasks

## Review Process

1. All PRs require at least one review
2. CI must pass (tests, linting, type checks)
3. Significant changes need documentation updates
4. Breaking changes require discussion first

## Getting Help

- **Discord**: Join our community (coming soon)
- **Issues**: Tag with `question` label
- **Email**: info@trozlan.io

## Recognition

Contributors are recognized in:
- CONTRIBUTORS.md file
- Release notes
- Project documentation

Thank you for helping make LLM Orchestra better!
