/**
 * Memory backend types
 */

import type { Message } from '../types/index.js';

export interface MemoryBackend {
  get(sessionId: string): Promise<Message[]>;
  set(sessionId: string, messages: Message[]): Promise<void>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

export interface InMemoryMemoryConfig {
  maxItems?: number;
  ttlSeconds?: number;
}
