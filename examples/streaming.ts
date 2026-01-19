/**
 * Streaming completion example
 */

import { Orchestra } from 'llm-orchestra';

const openaiKey = process.env.OPENAI_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!openaiKey && !anthropicKey) {
  throw new Error('Set OPENAI_API_KEY or ANTHROPIC_API_KEY to run this example.');
}

const model = openaiKey ? 'gpt-4o-mini' : 'claude-3-haiku';

const orchestra = new Orchestra({
  providers: {
    ...(openaiKey ? { openai: { apiKey: openaiKey } } : {}),
    ...(anthropicKey ? { anthropic: { apiKey: anthropicKey } } : {}),
  },
  observability: {
    tracing: { enabled: true },
    costTracking: { enabled: true },
  },
});

async function main() {
  console.log(`Streaming from ${model}...\n`);

  const stream = orchestra.stream({
    model,
    messages: [
      { role: 'system', content: 'You are a concise assistant.' },
      { role: 'user', content: 'Write a 3-line haiku about the ocean.' },
    ],
  });

  for await (const chunk of stream) {
    if (chunk.content) {
      process.stdout.write(chunk.content);
    }

    if (chunk.finishReason && chunk.meta) {
      console.log('\n\n---');
      console.log('Finish reason:', chunk.finishReason);
      console.log('Tokens:', chunk.meta.tokens);
      console.log('Cost:', chunk.meta.cost);
      console.log('Trace ID:', chunk.meta.traceId);
    }
  }

  await orchestra.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
