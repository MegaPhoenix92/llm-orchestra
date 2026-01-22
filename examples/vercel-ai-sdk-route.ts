/**
 * Vercel AI SDK integration example using the helper module.
 * Copy into app/api/chat/route.ts in a Next.js project.
 */

import { Orchestra, toVercelStream, type Message } from 'llm-orchestra';
// In actual usage: import { StreamingTextResponse } from 'ai';

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

  // Use the helper to convert Orchestra stream to Vercel AI SDK format
  const stream = orchestra.stream({ model, messages });
  const readable = toVercelStream(stream);

  // In actual usage:
  // return new StreamingTextResponse(readable);

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
