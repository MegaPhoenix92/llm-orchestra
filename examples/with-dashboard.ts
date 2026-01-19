/**
 * Dashboard Integration Example
 *
 * This example demonstrates how to use LLM Orchestra with
 * the local observability dashboard for real-time monitoring.
 *
 * Run with: npx tsx examples/with-dashboard.ts
 *
 * Then open http://localhost:3737 to view the dashboard
 */

import { Orchestra } from 'llm-orchestra';
import { attachDashboard } from 'llm-orchestra-dashboard';

async function main() {
  // Initialize Orchestra
  const orchestra = new Orchestra({
    providers: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
      },
    },
    observability: {
      tracing: {
        enabled: true,
        sampleRate: 1.0,
      },
      costTracking: {
        enabled: true,
        alertThreshold: 5.0,
      },
    },
  });

  // Attach the dashboard - it will serve at http://localhost:3737
  const dashboard = attachDashboard(orchestra, {
    port: 3737,
    open: true, // Automatically open browser
  });

  console.log('Dashboard running at http://localhost:3737');
  console.log('Press Ctrl+C to stop\n');

  // Simulate some API calls to populate the dashboard
  await simulateTraffic(orchestra);

  // Keep the server running
  await new Promise(() => {});
}

async function simulateTraffic(orchestra: Orchestra) {
  const prompts = [
    'What is the capital of France?',
    'Explain photosynthesis briefly.',
    'What is 15 * 23?',
    'Name three programming languages.',
    'What color is the sky?',
  ];

  const models = [
    'claude-3-haiku-20240307',
    'claude-3-sonnet-20240229',
    'gpt-3.5-turbo',
    'gpt-4',
  ];

  console.log('Simulating API calls...\n');

  for (let i = 0; i < 10; i++) {
    const prompt = prompts[i % prompts.length];
    const model = models[i % models.length];

    try {
      console.log(`[${i + 1}/10] ${model}: "${prompt.substring(0, 30)}..."`);

      const response = await orchestra.complete({
        model,
        messages: [{ role: 'user', content: prompt }],
        fallback: ['claude-3-haiku-20240307'], // Fallback if primary fails
      });

      console.log(`  -> ${response.meta.provider} | ${response.meta.latencyMs}ms | $${response.meta.cost.toFixed(6)}\n`);

      // Small delay between calls
      await sleep(500);
    } catch (error) {
      console.log(`  -> Failed: ${(error as Error).message}\n`);
    }
  }

  console.log('Simulation complete. View results at http://localhost:3737');
  console.log('\nDashboard features:');
  console.log('  / - Overview with stats and real-time feed');
  console.log('  /traces - View all traces with filtering');
  console.log('  /costs - Cost breakdown by provider/model');
  console.log('  /health - Provider health status\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
