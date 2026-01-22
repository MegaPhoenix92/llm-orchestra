# LangChain Integration

This guide shows how to use LangChain with LLM Orchestra. Orchestra provides
a `OrchestraChatModel` wrapper that enables use in LCEL pipelines, plus helpers
for message conversion.

## Install

```bash
npm install llm-orchestra @langchain/core
```

## Quick Start (OrchestraChatModel)

The `OrchestraChatModel` class provides full LCEL compatibility:

```ts
import { Orchestra, OrchestraChatModel } from 'llm-orchestra';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

const orchestra = new Orchestra({
  providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY ?? '' } },
});

const model = new OrchestraChatModel({
  orchestra,
  model: 'claude-3-haiku',
  fallback: ['gpt-4o-mini'],  // Automatic failover
  tags: ['production'],       // For cost tracking
});

// LCEL-style chaining
const chain = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful assistant.'],
  ['human', '{question}'],
]).pipe(model).pipe(new StringOutputParser());

const result = await chain.invoke({ question: 'What is AI?' });
```

## Streaming

```ts
for await (const chunk of model.stream('Tell me a joke')) {
  process.stdout.write(chunk);
}
```

## With Tools

```ts
const modelWithTools = model.bind({
  tools: [{ name: 'get_weather', description: 'Get weather for a location' }],
});

const result = await modelWithTools.invoke('What is the weather in NYC?');
console.log(result.tool_calls);
```

## Manual Message Conversion

For more control, use the `toOrchestraMessages` helper:

```ts
import { Orchestra, toOrchestraMessages } from 'llm-orchestra';
import { ChatPromptTemplate } from '@langchain/core/prompts';

const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a concise assistant.'],
  ['human', '{question}'],
]);

const langchainMessages = await prompt.formatMessages({ question: 'What is AI?' });
const orchestraMessages = toOrchestraMessages(langchainMessages);

const response = await orchestra.complete({
  model: 'claude-3-haiku',
  messages: orchestraMessages,
});
```

## Legacy: Prompt + Orchestra Example

```ts
import { Orchestra, type Message } from 'llm-orchestra';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseMessage } from '@langchain/core/messages';

const orchestra = new Orchestra({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY ?? '' },
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
```

## Notes

- If you want streaming, swap `orchestra.complete()` with `orchestra.stream()`
  and forward chunks to your LangChain consumer.
- Keep LangChain prompts and tools on the LangChain side, and let Orchestra
  handle provider selection and observability.
