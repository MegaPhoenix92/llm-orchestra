# LLM Orchestra Examples

This directory contains example code demonstrating LLM Orchestra features.

## Prerequisites

```bash
# Set your API key
export ANTHROPIC_API_KEY="your-key-here"

# Run any example with tsx
npx tsx examples/<example-name>.ts
```

## Examples

### Basic Usage (`basic-usage.ts`)
Simple completion request with cost tracking and stats.

### Tool Use (`tool-use.ts`)
Using function calling/tools with LLM Orchestra.

### Dashboard Integration (`with-dashboard.ts`)
Real-time monitoring dashboard attached to Orchestra instance.

### Workflow Engine (`workflow.ts`)
Multi-step AI pipelines with:
- State management across steps
- Error handling with dedicated error step
- Execution timing and cost tracking

### Tracing & OTEL Export (`tracing-export.ts`)
Distributed tracing configuration for:
- Jaeger, Zipkin, Grafana Tempo
- Honeycomb, Datadog
- Custom span creation
- Trace correlation

### Multi-Agent Coordination (`multi-agent.ts`)
File-based agent coordination with:
- Agent registration and heartbeat
- Task creation and claiming
- Inter-agent messaging
- Collaborative workflows

## Running Examples

```bash
# Basic usage
npx tsx examples/basic-usage.ts

# Workflow engine
npx tsx examples/workflow.ts

# With dashboard (opens browser)
npx tsx examples/with-dashboard.ts

# Tracing (requires OTEL collector)
OTEL_EXPORTER_ENDPOINT=http://localhost:4318/v1/traces npx tsx examples/tracing-export.ts

# Multi-agent
npx tsx examples/multi-agent.ts
```

## Example Output

Each example outputs:
- Operation results
- Token usage statistics
- Cost breakdown
- Trace IDs (where applicable)
