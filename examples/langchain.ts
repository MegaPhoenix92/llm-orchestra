/**
 * LangChain integration example using OrchestraChatModel.
 *
 * This example demonstrates two approaches:
 * 1. Using OrchestraChatModel for LCEL-style pipelines
 * 2. Manual message conversion for more control
 */

import { Orchestra, OrchestraChatModel, toOrchestraMessages, type Message } from 'llm-orchestra';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import type { BaseMessage } from '@langchain/core/messages';

const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!anthropicKey) {
  throw new Error('Set ANTHROPIC_API_KEY to run this example.');
}

const orchestra = new Orchestra({
  providers: {
    anthropic: { apiKey: anthropicKey },
  },
  observability: {
    tracing: { enabled: true },
    costTracking: { enabled: true },
  },
});

// ============================================================================
// Approach 1: Using OrchestraChatModel for LCEL pipelines
// ============================================================================

async function exampleWithChatModel() {
  console.log('=== Using OrchestraChatModel ===\n');

  // Create a LangChain-compatible model
  const model = new OrchestraChatModel({
    orchestra,
    model: 'claude-3-haiku',
    fallback: ['gpt-4o-mini'],
    tags: ['langchain', 'example'],
  });

  // Create an LCEL chain
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', 'You are a concise assistant. Keep answers under 50 words.'],
    ['human', '{question}'],
  ]);

  const outputParser = new StringOutputParser();

  // Chain them together: prompt -> model -> parser
  const chain = prompt.pipe(model).pipe(outputParser);

  // Invoke the chain
  const result = await chain.invoke({
    question: 'What is a vector database in one sentence?',
  });

  console.log('Result:', result);
  console.log();
}

// ============================================================================
// Approach 2: Using OrchestraChatModel with streaming
// ============================================================================

async function exampleWithStreaming() {
  console.log('=== Streaming with OrchestraChatModel ===\n');

  const model = new OrchestraChatModel({
    orchestra,
    model: 'claude-3-haiku',
    tags: ['langchain', 'streaming'],
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', 'You are a helpful assistant.'],
    ['human', 'Count from 1 to 5, with a brief pause description between each number.'],
  ]);

  const messages = await prompt.formatMessages({});

  // Convert to LangChain message format for the model
  const langchainMessages = messages.map((m) => ({
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    _getType: () => m._getType(),
  }));

  console.log('Streaming response:');
  for await (const chunk of model.stream(langchainMessages)) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

// ============================================================================
// Approach 3: Manual conversion for more control
// ============================================================================

function messageContent(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function manualToOrchestraMessages(messages: BaseMessage[]): Message[] {
  return messages.map((message) => {
    const type = message._getType();
    if (type === 'system') {
      return { role: 'system' as const, content: messageContent(message.content) };
    }
    if (type === 'ai') {
      return { role: 'assistant' as const, content: messageContent(message.content) };
    }
    if (type === 'tool') {
      return { role: 'tool' as const, content: messageContent(message.content) };
    }
    return { role: 'user' as const, content: messageContent(message.content) };
  });
}

async function exampleWithManualConversion() {
  console.log('=== Manual Conversion Approach ===\n');

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', 'You are a concise assistant.'],
    ['human', 'Answer the question clearly: {question}'],
  ]);

  const langchainMessages = await prompt.formatMessages({
    question: 'What is a vector database?',
  });

  // Use the exported helper or manual conversion
  const orchestraMessages = manualToOrchestraMessages(langchainMessages);

  const response = await orchestra.complete({
    model: 'claude-3-haiku',
    messages: orchestraMessages,
    fallback: ['gpt-4o-mini'],
    tags: ['langchain', 'manual'],
  });

  console.log('Response:', response.content);
  console.log('\nMetadata:', {
    provider: response.meta.provider,
    model: response.meta.model,
    tokens: response.meta.tokens,
    cost: `$${response.meta.cost.toFixed(6)}`,
    latencyMs: response.meta.latencyMs,
  });
  console.log();
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    await exampleWithChatModel();
    await exampleWithStreaming();
    await exampleWithManualConversion();
  } finally {
    await orchestra.shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
