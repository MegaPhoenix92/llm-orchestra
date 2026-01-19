/**
 * Multi-Agent Coordination Example
 *
 * This example demonstrates how to coordinate multiple AI agents
 * using LLM Orchestra's AgentCoord system for:
 * - Agent registration and discovery
 * - Task assignment and claiming
 * - Inter-agent messaging
 * - Collaborative workflows
 *
 * Run with: npx tsx examples/multi-agent.ts
 */

import { Orchestra } from 'llm-orchestra';
// Note: AgentCoord is available from the agents module
import { AgentCoord } from '../src/agents/agent-state.js';

async function main() {
  console.log('=== Multi-Agent Coordination Example ===\n');

  // Initialize Orchestra
  const orchestra = new Orchestra({
    providers: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    },
    observability: {
      tracing: { enabled: true },
    },
  });

  // Create two coordinated agents
  const researchAgent = new AgentCoord({
    agentName: 'researcher',
    stateDir: '.agent-state-example',
  });

  const writerAgent = new AgentCoord({
    agentName: 'writer',
    stateDir: '.agent-state-example',
  });

  // Initialize the coordination system
  await researchAgent.init();
  await writerAgent.init();

  // Step 1: Register agents with heartbeat
  console.log('--- Step 1: Agent Registration ---');
  await researchAgent.heartbeat('Initializing research capabilities');
  await writerAgent.heartbeat('Initializing writing capabilities');

  // Check who's active
  const activeAgents = await researchAgent.whoIsWorking();
  console.log('Active agents:', activeAgents.active.map((a) => a.name).join(', '));

  // Step 2: Create a collaborative task
  console.log('\n--- Step 2: Task Creation ---');
  const task = await researchAgent.createTask(
    'Research and Write Article',
    'Research TypeScript best practices and write a summary',
    {
      priority: 'high',
      tags: ['research', 'writing', 'typescript'],
    }
  );
  console.log('Created task:', task.id, '-', task.title);

  // Step 3: Claim the task
  console.log('\n--- Step 3: Task Claiming ---');
  const claimed = await researchAgent.claimTask(task.id);
  if (claimed) {
    console.log('Researcher claimed the task');
    await researchAgent.heartbeat('Researching TypeScript best practices');
  }

  // Step 4: Do the research
  console.log('\n--- Step 4: Research Phase ---');
  const researchResponse = await orchestra.complete({
    model: 'claude-3-haiku-20240307',
    messages: [
      {
        role: 'user',
        content: 'List 3 key TypeScript best practices for large codebases. Be brief.',
      },
    ],
  });

  console.log('Research findings:', researchResponse.content.substring(0, 100) + '...');

  // Step 5: Share findings with writer agent
  console.log('\n--- Step 5: Inter-Agent Communication ---');
  await researchAgent.sendMessage('writer', 'finding', 'Research complete', {
    findings: researchResponse.content,
    sources: ['TypeScript documentation', 'Best practices guide'],
  });
  console.log('Sent research findings to writer agent');

  // Writer checks inbox
  const inbox = await writerAgent.getInbox();
  console.log('Writer inbox has', inbox.length, 'message(s)');

  if (inbox.length > 0) {
    const message = inbox[0];
    console.log('Message from:', message.from);
    console.log('Type:', message.type);
    console.log('Content preview:', message.content);

    // Mark as read
    await writerAgent.markAsRead(message.id);
  }

  // Step 6: Writer takes over
  console.log('\n--- Step 6: Writing Phase ---');
  await writerAgent.heartbeat('Writing summary based on research');

  const writeResponse = await orchestra.complete({
    model: 'claude-3-haiku-20240307',
    messages: [
      {
        role: 'user',
        content: `Based on these findings:\n${researchResponse.content}\n\nWrite a 2-sentence summary.`,
      },
    ],
  });

  console.log('Written summary:', writeResponse.content);

  // Step 7: Complete the task
  console.log('\n--- Step 7: Task Completion ---');
  await researchAgent.updateTask(task.id, {
    status: 'completed',
    result: {
      research: researchResponse.content,
      summary: writeResponse.content,
      collaborators: ['researcher', 'writer'],
    },
  });

  // Verify task status
  const allTasks = await researchAgent.listTasks();
  const completedTask = allTasks.find((t) => t.id === task.id);
  console.log('Task status:', completedTask?.status);

  // Step 8: Broadcast completion
  console.log('\n--- Step 8: Broadcast ---');
  await researchAgent.sendMessage('broadcast', 'response', 'Task completed successfully', {
    taskId: task.id,
    result: 'Article research and writing complete',
  });

  // Final stats
  console.log('\n=== Coordination Summary ===');
  const finalAgents = await researchAgent.whoIsWorking();
  console.log('Active agents:', finalAgents.active.length);
  console.log('Tasks completed:', allTasks.filter((t) => t.status === 'completed').length);

  const stats = orchestra.getStats();
  console.log('Total LLM requests:', stats.totalRequests);
  console.log('Total cost: $' + stats.totalCost.toFixed(6));

  // Cleanup
  await orchestra.shutdown();

  console.log(`
=== Multi-Agent Patterns ===

1. Agent Registration:
   - Each agent registers with heartbeat()
   - Status: active, idle, busy, offline
   - Auto-cleanup of stale agents (5 min TTL)

2. Task Management:
   - createTask() - Create new tasks
   - claimTask() - Agent claims a task
   - completeTask() - Mark task done with result
   - getTasks() - List all tasks

3. Messaging:
   - sendMessage() - Send to specific agent or broadcast
   - getInbox() - Check for messages
   - markAsRead() - Acknowledge messages

4. Coordination:
   - whoIsWorking() - See active/busy agents
   - File-based state (works across processes)
   - No central server required
`);
}

main().catch(console.error);
