# Vercel AI SDK Integration

This guide shows how to stream responses from LLM Orchestra through a Next.js
API route using the Vercel AI SDK. LLM Orchestra provides built-in helpers
for seamless integration.

## Install

```bash
npm install ai llm-orchestra
```

## Quick Start (Using Helpers)

The simplest way to integrate is using the `toVercelStream` helper:

```ts
import { Orchestra, toVercelStream } from 'llm-orchestra';
import { StreamingTextResponse } from 'ai';

const orchestra = new Orchestra({
  providers: { openai: { apiKey: process.env.OPENAI_API_KEY ?? '' } },
});

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = orchestra.stream({ model: 'gpt-4o-mini', messages });
  return new StreamingTextResponse(toVercelStream(stream));
}
```

## With Metadata (StreamData)

To pass metadata (tokens, cost, traceId) to the client:

```ts
import { Orchestra, toVercelStream } from 'llm-orchestra';
import { StreamingTextResponse, StreamData } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = orchestra.stream({ model: 'gpt-4o-mini', messages });
  const data = new StreamData();

  const readable = toVercelStream(stream, { data });
  return new StreamingTextResponse(readable, {}, data);
}
```

## Next.js Route Example (Full)

Create `app/api/chat/route.ts`:

```ts
import { Orchestra, type Message } from 'llm-orchestra';
import { StreamingTextResponse } from 'ai';

export const runtime = 'nodejs';

const orchestra = new Orchestra({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY ?? '' },
  },
  observability: {
    tracing: { enabled: true },
    costTracking: { enabled: true },
  },
});

const VALID_ROLES = new Set<Message['role']>(['system', 'user', 'assistant', 'tool']);
const DEFAULT_MODEL = 'gpt-4o-mini';

function toOrchestraMessages(input: unknown): Message[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (item): item is { role: Message['role']; content: string } =>
        !!item &&
        typeof item === 'object' &&
        VALID_ROLES.has((item as { role: Message['role'] }).role) &&
        typeof (item as { content: string }).content === 'string'
    )
    .map((item) => ({ role: item.role, content: item.content }));
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response('Missing OPENAI_API_KEY', { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const messages = toOrchestraMessages(body?.messages);

  if (messages.length === 0) {
    return new Response('Invalid messages payload', { status: 400 });
  }

  const model =
    typeof body?.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : DEFAULT_MODEL;

  const stream = orchestra.stream({ model, messages });
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.content) {
            controller.enqueue(encoder.encode(chunk.content));
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new StreamingTextResponse(readable);
}
```

## useChat + Data Stream Metadata

If you want `useChat` plus extra metadata (tokens, cost, trace ID), attach a
data stream. The AI SDK will surface this data on the client.

```ts
import { Orchestra, type Message } from 'llm-orchestra';
import { StreamingTextResponse, StreamData } from 'ai';

export const runtime = 'nodejs';

const orchestra = new Orchestra({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY ?? '' },
  },
  observability: {
    tracing: { enabled: true },
    costTracking: { enabled: true },
  },
});

const VALID_ROLES = new Set<Message['role']>(['system', 'user', 'assistant', 'tool']);
const DEFAULT_MODEL = 'gpt-4o-mini';

function toOrchestraMessages(input: unknown): Message[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (item): item is { role: Message['role']; content: string } =>
        !!item &&
        typeof item === 'object' &&
        VALID_ROLES.has((item as { role: Message['role'] }).role) &&
        typeof (item as { content: string }).content === 'string'
    )
    .map((item) => ({ role: item.role, content: item.content }));
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response('Missing OPENAI_API_KEY', { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const messages = toOrchestraMessages(body?.messages);

  if (messages.length === 0) {
    return new Response('Invalid messages payload', { status: 400 });
  }

  const model =
    typeof body?.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : DEFAULT_MODEL;

  const stream = orchestra.stream({ model, messages });
  const data = new StreamData();
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.content) {
            controller.enqueue(encoder.encode(chunk.content));
          }
          if (chunk.finishReason && chunk.meta) {
            data.append({ meta: chunk.meta });
          }
        }
        data.close();
        controller.close();
      } catch (error) {
        data.append({ error: 'stream_failed' });
        data.close();
        controller.error(error);
      }
    },
  });

  return new StreamingTextResponse(readable, {}, data);
}
```

## Client Example (React)

```tsx
import { useCompletion } from 'ai/react';

export function ChatBox() {
  const { completion, input, handleInputChange, handleSubmit, isLoading } =
    useCompletion({ api: '/api/chat' });

  return (
    <form onSubmit={handleSubmit}>
      <textarea value={completion} readOnly />
      <input value={input} onChange={handleInputChange} />
      <button type="submit" disabled={isLoading}>
        Send
      </button>
    </form>
  );
}
```

## useChat Client Example

```tsx
import { useChat } from 'ai/react';

export function ChatBox() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({ api: '/api/chat' });

  return (
    <form onSubmit={handleSubmit}>
      <div>
        {messages.map((message) => (
          <p key={message.id}>
            <strong>{message.role}:</strong> {message.content}
          </p>
        ))}
      </div>
      <input value={input} onChange={handleInputChange} />
      <button type="submit" disabled={isLoading}>
        Send
      </button>
    </form>
  );
}
```

## Notes

- Use the Node.js runtime for API routes to ensure provider SDKs work reliably.
- If you need tool calling or structured output, map those fields from
  `orchestra.stream()` into your chosen client protocol.
