# Claude Agent Guide for LLM Orchestra

## Project Overview

LLM Orchestra is a unified observability and orchestration SDK for multi-model AI applications. It provides:
- Unified interface for Claude, GPT-4, Gemini, and more
- Automatic failover between providers
- Distributed tracing and cost tracking
- Multi-agent coordination

## IMPORTANT: Agent Identification Required

When working on LLM Orchestra, **ALWAYS** identify yourself in all operations:

```typescript
// Initialize AgentCoord for coordination
import { AgentCoord } from './src/agents';

const coord = new AgentCoord({ agentName: 'claude' });
await coord.init();
await coord.heartbeat('Working on LLM Orchestra');
```

## Quick Reference

### Project Structure
```
llm-orchestra/
├── src/
│   ├── index.ts           # Main exports
│   ├── orchestra.ts       # Orchestra class
│   ├── types/             # Type definitions
│   ├── providers/         # Provider adapters
│   │   ├── anthropic.ts   # Claude adapter
│   │   ├── openai.ts      # GPT adapter
│   │   └── google.ts      # Gemini adapter
│   ├── routing/           # Request routing
│   ├── tracing/           # Distributed tracing
│   └── agents/            # Agent coordination
├── CLAUDE.md              # This file
├── GEMINI.md              # Gemini guide
└── README.md              # Project readme
```

### Common Operations

```typescript
// Search in this project
{
  agent: 'claude',
  action: 'search',
  project: 'llm-orchestra',
  query: 'your search term'
}

// Execute commands
{
  agent: 'claude',
  action: 'execute',
  project: 'llm-orchestra',
  command: 'npm test'
}
```

## Multi-Agent Collaboration

Before making changes:

1. **Check who's working**:
   ```typescript
   const coord = new AgentCoord({ agentName: 'claude' });
   const status = await coord.whoIsWorking();
   console.log('Active agents:', status.active);
   console.log('Busy agents:', status.busy);
   ```

2. **Share your plans**:
   ```typescript
   await coord.sendMessage('broadcast', 'finding', 'Working on provider routing', {
     files: ['src/routing/router.ts'],
     intent: 'Implementing automatic failover'
   });
   ```

3. **Check inbox**:
   ```typescript
   const messages = await coord.getInbox();
   for (const msg of messages) {
     console.log(`${msg.from}: ${msg.content}`);
     await coord.markAsRead(msg.id);
   }
   ```

## Claude's Strengths in This Project

- **Deep code understanding** - Complex routing and tracing logic
- **Multi-file coordination** - Provider adapters and type consistency
- **Architecture decisions** - Failover strategies, caching patterns
- **Documentation** - Comprehensive JSDoc and README updates

## Development Commands

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npx tsc --noEmit
```

## Key Files for Claude

| File | Purpose |
|------|---------|
| `src/orchestra.ts` | Main orchestration class |
| `src/providers/anthropic.ts` | Claude API adapter |
| `src/routing/router.ts` | Request routing with failover |
| `src/tracing/tracer.ts` | Distributed tracing |
| `src/agents/agent-state.ts` | Multi-agent coordination |

## Best Practices

1. **Always use** `agent: 'claude'` in coordination calls
2. **Check for other agents** before major changes
3. **Update coordination** with your current task
4. **Test thoroughly** before committing
5. **Request code review** from another agent before finalizing

## 🔄 Mandatory PR Review Process

### Every Commit Must Be Reviewed

**ALL code changes must go through review by @codex and GitHub Copilot before merging.**

### PR Review Workflow

```bash
# 1. Create feature branch
git checkout -b feat/your-feature-name

# 2. Make changes, run tests to verify
npm test

# 3. Commit with co-author
git add .
git commit -m "$(cat <<'EOF'
feat: your feature description

Detailed description of changes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"

# 4. Push and create PR
git push -u origin feat/your-feature-name
gh pr create --title "feat: your feature" --body "$(cat <<'EOF'
## Summary
- Description of changes

## Test plan
- [x] All tests pass
- [x] Manual verification done

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# 5. Request reviews from @codex and Copilot
PR_NUM=$(gh pr view --json number -q '.number')
gh pr comment $PR_NUM --body "@codex please review this PR for code quality, security, and best practices."
gh api repos/{owner}/{repo}/pulls/$PR_NUM/requested_reviewers -f "reviewers[]=copilot"

# 6. Wait for reviews and check status
gh api repos/{owner}/{repo}/pulls/$PR_NUM/reviews --jq '.[] | {user: .user.login, state: .state}'
gh api repos/{owner}/{repo}/pulls/$PR_NUM/comments --jq '.[].body'

# 7. After approval, merge
gh pr merge --squash --delete-branch
```

### @codex Review Responses

| Response | Meaning | Action |
|----------|---------|--------|
| "Didn't find any major issues. Nice work!" | No issues found | Proceed to merge |
| P1 Badge (Red) | Critical issue | Must fix before merge |
| P2 Badge (Yellow) | Important issue | Should fix before merge |
| P3 Badge (Blue) | Minor suggestion | Nice to fix |

### Handling @codex Feedback

When @codex finds issues:

```bash
# Option 1: Ask @codex to fix (requires Codex account setup)
gh pr comment $PR_NUM --body "@codex address that feedback"

# Option 2: Fix manually, commit, and push
git add .
git commit -m "fix: address @codex feedback

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
git push
```

### Review Checklist Before Creating PR

- [ ] All tests pass locally (`npm test`)
- [ ] No TypeScript/ESLint errors
- [ ] Code follows project conventions
- [ ] No sensitive data committed
- [ ] Commit messages follow conventional commits format
- [ ] PR description includes summary and test plan

## Integration with TROZLAN

LLM Orchestra is part of the TROZLAN ecosystem:
- Located in `TROZLANIO/llm-orchestra`
- Shares agent coordination patterns with networks
- Uses consistent multi-agent protocols

Remember: Every action makes the system smarter! 🚀
