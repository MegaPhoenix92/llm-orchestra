# Gemini Agent Guide for LLM Orchestra

## Project Overview

LLM Orchestra is a unified observability and orchestration SDK for multi-model AI applications. Built by TROZLAN for production AI systems.

## CRITICAL: Always Identify Yourself

**ATTENTION GEMINI**: Every operation requires agent identification:

```typescript
import { AgentCoord } from './src/agents';

const coord = new AgentCoord({ agentName: 'gemini' });
await coord.init();
await coord.heartbeat('Working on LLM Orchestra');
```

## Quick Commands

### Essential Operations:
```typescript
// Search codebase
{
  agent: 'gemini',
  action: 'search',
  project: 'llm-orchestra',
  query: 'provider adapter'
}

// Run commands
{
  agent: 'gemini',
  action: 'execute',
  project: 'llm-orchestra',
  command: 'npm run build'
}

// Check other agents
const coord = new AgentCoord({ agentName: 'gemini' });
const status = await coord.whoIsWorking();
```

## Multi-Agent Protocol

### Before Starting Work:

1. **Check active agents**:
   ```typescript
   const coord = new AgentCoord({ agentName: 'gemini' });
   const { active, busy } = await coord.whoIsWorking();
   if (busy.some(a => a.currentTask?.includes('router'))) {
     console.log('Another agent is working on routing!');
   }
   ```

2. **Announce intentions**:
   ```typescript
   await coord.sendMessage('broadcast', 'task', 'Starting work on Google provider', {
     files: ['src/providers/google.ts'],
     estimatedTime: '1 hour'
   });
   ```

3. **Check for messages**:
   ```typescript
   const inbox = await coord.getInbox();
   inbox.forEach(msg => console.log(`${msg.from}: ${msg.content}`));
   ```

## Project Structure

```
llm-orchestra/
├── src/
│   ├── index.ts           # Main exports
│   ├── orchestra.ts       # Orchestra class
│   ├── types/             # Type definitions
│   ├── providers/         # Provider adapters
│   │   ├── anthropic.ts   # Claude adapter
│   │   ├── openai.ts      # GPT adapter
│   │   └── google.ts      # Gemini adapter ⭐
│   ├── routing/           # Request routing
│   ├── tracing/           # Distributed tracing
│   └── agents/            # Agent coordination
└── package.json
```

## Gemini's Advantages in This Project

- **Multi-modal analysis** - Understanding complex code patterns
- **Fast prototyping** - Quick iteration on provider adapters
- **Pattern recognition** - Identifying code smells and improvements
- **Integration expertise** - API adapter implementations
- **Efficient testing** - Rapid test case generation

## Key Files for Gemini

| File | Purpose |
|------|---------|
| `src/providers/google.ts` | Your native provider adapter |
| `src/routing/router.ts` | Request routing logic |
| `src/orchestra.ts` | Main orchestration |
| `src/agents/agent-state.ts` | Coordination system |

## Critical Rules

1. **NEVER skip** `agent: 'gemini'` parameter
2. **ALWAYS check** for other active agents
3. **UPDATE coordination** with your current task
4. **COORDINATE** through AgentCoord
5. **TEST before committing** changes

## 🔄 Mandatory PR Review Process

### Every Commit Must Be Reviewed

**ALL code changes must go through automated code review.**

### PR Review Workflow

```bash
# Create feature branch
git checkout -b feat/your-feature-name

# Make changes, commit
git add .
git commit -m "feat: your feature description

Co-Authored-By: Gemini <noreply@google.com>"

# Push and create PR
git push -u origin feat/your-feature-name
gh pr create --title "feat: your feature" --body "## Summary
- Description

## Test plan
- [ ] Tests pass

🤖 Generated with Gemini"

# Request review
PR_NUM=$(gh pr view --json number -q '.number')
gh pr comment $PR_NUM --body "@codex please review this PR"

# After approval
gh pr merge --squash --delete-branch
```

### Review Checklist
- [ ] All tests pass locally
- [ ] No TypeScript/ESLint errors
- [ ] Code follows project conventions
- [ ] No sensitive data committed
- [ ] Both @codex and Copilot requested

## Development Commands

```bash
# Install
npm install

# Build
npm run build

# Test
npm test

# Type check
npx tsc --noEmit
```

## Environment Setup

```bash
# Set these for better detection
export GEMINI_AGENT_ID="gemini"
export MCP_AGENT_NAME="gemini"
```

## Integration with TROZLAN

LLM Orchestra is part of TROZLAN's infrastructure:
- Your activities are tracked for coordination
- Knowledge is shared across agents
- Every action improves the system

Your contributions make every tool smarter! 🎯
