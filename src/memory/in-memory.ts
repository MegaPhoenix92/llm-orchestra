/**
 * In-memory conversation memory backend
 */

import type { Message } from '../types/index.js';
import type { InMemoryMemoryConfig, MemoryBackend } from './types.js';

interface MemoryEntry {
  messages: Message[];
  updatedAt: number;
}

const DEFAULT_MAX_ITEMS = 200;
const DEFAULT_TTL_SECONDS = 3600;

export class InMemoryMemoryBackend implements MemoryBackend {
  private entries = new Map<string, MemoryEntry>();
  private maxItems: number;
  private ttlSeconds: number;

  constructor(config?: InMemoryMemoryConfig) {
    this.maxItems = config?.maxItems ?? DEFAULT_MAX_ITEMS;
    this.ttlSeconds = config?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  async get(sessionId: string): Promise<Message[]> {
    const entry = this.entries.get(sessionId);
    if (!entry) return [];
    if (this.isExpired(entry)) {
      this.entries.delete(sessionId);
      return [];
    }
    return entry.messages.map((message) => ({ ...message }));
  }

  async set(sessionId: string, messages: Message[]): Promise<void> {
    this.entries.set(sessionId, {
      messages: this.pruneMessages(messages),
      updatedAt: Date.now(),
    });
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    const existing = await this.get(sessionId);
    const combined = existing.concat(messages);
    await this.set(sessionId, combined);
  }

  async clear(sessionId: string): Promise<void> {
    this.entries.delete(sessionId);
  }

  private isExpired(entry: MemoryEntry): boolean {
    return Date.now() - entry.updatedAt > this.ttlSeconds * 1000;
  }

  private pruneMessages(messages: Message[]): Message[] {
    if (messages.length <= this.maxItems) return messages.map((message) => ({ ...message }));
    return messages.slice(messages.length - this.maxItems).map((message) => ({ ...message }));
  }
}
