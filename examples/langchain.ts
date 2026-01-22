/**
 * LangChain integration example.
 */

import { Orchestra, type Message } from 'llm-orchestra';
import { ChatPromptTemplate } from '@langchain/core/prompts';
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

function messageContent(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function toOrchestraMessages(messages: BaseMessage[]): Message[] {
  return messages.map((message) => {
    const type = message._getType();
    if (type === 'system') {
      return { role: 'system', content: messageContent(message.content) };
    }
    if (type === 'ai') {
      return { role: 'assistant', content: messageContent(message.content) };
    }
    if (type === 'tool') {
      return { role: 'tool', content: messageContent(message.content) };
    }
    return { role: 'user', content: messageContent(message.content) };
  });
}

const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a concise assistant.'],
  ['human', 'Answer the question clearly: {question}'],
]);

async function main() {
  const langchainMessages = await prompt.formatMessages({
    question: 'What is a vector database?',
  });

  const response = await orchestra.complete({
    model: 'claude-3-haiku',
    messages: toOrchestraMessages(langchainMessages),
    fallback: ['gpt-4o-mini'],
    tags: ['langchain'],
  });

  console.log(response.content);
  await orchestra.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
