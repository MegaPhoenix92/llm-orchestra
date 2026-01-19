/**
 * Basic Usage Example
 *
 * This example demonstrates core LLM Orchestra features:
 * - Multi-provider configuration
 * - Automatic failover
 * - Cost tracking
 * - Statistics
 *
 * Run with: npx tsx examples/basic-usage.ts
 */

import { Orchestra } from 'llm-orchestra';

async function main() {
  // Initialize Orchestra with multiple providers
  const orchestra = new Orchestra({
    providers: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
      },
      google: {
        apiKey: process.env.GOOGLE_API_KEY!,
      },
    },
    // Retry configuration for resilience
    retry: {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'SERVER_ERROR'],
    },
    // Enable cost tracking
    observability: {
      costTracking: {
        enabled: true,
        alertThreshold: 1.0, // Alert when costs exceed $1
        budgetLimit: 10.0, // Hard limit at $10
      },
      tracing: {
        enabled: true,
        sampleRate: 1.0,
        includePrompts: false, // Don't log prompt content
      },
    },
  });

  console.log('Available providers:', orchestra.getProviders());

  // Example 1: Simple completion with Claude
  console.log('\n--- Example 1: Simple Completion ---');
  try {
    const response = await orchestra.complete({
      model: 'claude-3-haiku-20240307',
      messages: [
        { role: 'user', content: 'What is 2 + 2? Reply with just the number.' },
      ],
    });

    console.log('Response:', response.content);
    console.log('Provider:', response.meta.provider);
    console.log('Model:', response.meta.model);
    console.log('Tokens:', response.meta.tokens);
    console.log('Cost: $' + response.meta.cost.toFixed(6));
    console.log('Latency:', response.meta.latencyMs + 'ms');
  } catch (error) {
    console.error('Completion failed:', error);
  }

  // Example 2: Completion with automatic failover
  console.log('\n--- Example 2: Failover Support ---');
  try {
    const response = await orchestra.complete({
      model: 'claude-3-sonnet-20240229',
      fallback: ['gpt-4', 'gemini-1.5-pro'],
      messages: [
        { role: 'user', content: 'Explain quantum computing in one sentence.' },
      ],
    });

    console.log('Response:', response.content);
    console.log('Used provider:', response.meta.provider);
    console.log('Failover attempts:', response.meta.failoverAttempts);
  } catch (error) {
    console.error('All providers failed:', error);
  }

  // Example 3: Streaming response
  console.log('\n--- Example 3: Streaming ---');
  try {
    const stream = orchestra.stream({
      model: 'claude-3-haiku-20240307',
      messages: [
        { role: 'user', content: 'Count from 1 to 5, one number per line.' },
      ],
    });

    process.stdout.write('Streaming: ');
    for await (const chunk of stream) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
      }
      if (chunk.meta) {
        console.log('\nStream complete. Cost: $' + chunk.meta.cost?.toFixed(6));
      }
    }
  } catch (error) {
    console.error('Stream failed:', error);
  }

  // Example 4: Check statistics
  console.log('\n--- Example 4: Statistics ---');
  const stats = orchestra.getStats();
  console.log('Total requests:', stats.totalRequests);
  console.log('Total tokens:', stats.totalTokens);
  console.log('Total cost: $' + stats.totalCost.toFixed(6));
  console.log('By provider:', stats.byProvider);

  // Example 5: Model pricing lookup
  console.log('\n--- Example 5: Model Pricing ---');
  const pricing = orchestra.getModelCost('claude-3-sonnet-20240229');
  if (pricing) {
    console.log('Claude Sonnet pricing:');
    console.log('  Input: $' + pricing.inputPer1k + ' per 1K tokens');
    console.log('  Output: $' + pricing.outputPer1k + ' per 1K tokens');
  }

  // Cleanup
  await orchestra.shutdown();
  console.log('\nOrchestra shutdown complete.');
}

main().catch(console.error);
