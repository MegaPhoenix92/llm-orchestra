/**
 * Semantic cache for LLM responses
 */

import type {
  CompletionRequest,
  CompletionResponse,
  CacheConfig,
  CacheEmbeddingFunction,
  CacheKeyFunction,
  CacheEmbeddingInput,
} from '../types/index.js';

interface CacheEntry {
  signature: string;
  embedding: number[];
  response: CompletionResponse;
  createdAt: number;
  lastAccessed: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.9;
const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_MAX_SIZE = 500;
const DEFAULT_EMBEDDING_DIM = 128;

export class SemanticCache {
  private entries: CacheEntry[] = [];
  private config: Required<Pick<CacheConfig, 'ttlSeconds' | 'maxSize' | 'similarityThreshold'>>;
  private embedder: CacheEmbeddingFunction;
  private keyFunction: CacheKeyFunction;

  constructor(config: CacheConfig) {
    this.config = {
      ttlSeconds: config.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      maxSize: config.maxSize ?? DEFAULT_MAX_SIZE,
      similarityThreshold: config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
    };
    this.embedder = config.embeddingFunction ?? defaultEmbedder;
    this.keyFunction = config.keyFunction ?? defaultKeyFunction;
  }

  async get(request: CompletionRequest): Promise<CompletionResponse | null> {
    const signature = this.keyFunction(request);
    this.pruneExpired();

    const candidates = this.entries.filter((entry) => entry.signature === signature);
    if (candidates.length === 0) return null;

    const embedding = await this.embedder({
      text: buildEmbeddingText(request),
      request,
    });

    let bestMatch: CacheEntry | null = null;
    let bestScore = this.config.similarityThreshold;

    for (const entry of candidates) {
      const score = cosineSimilarity(embedding, entry.embedding);
      if (score >= bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    if (!bestMatch) return null;

    bestMatch.lastAccessed = Date.now();
    return cloneResponse(bestMatch.response);
  }

  async set(
    request: CompletionRequest,
    response: CompletionResponse
  ): Promise<void> {
    const signature = this.keyFunction(request);
    const embedding = await this.embedder({
      text: buildEmbeddingText(request),
      request,
    });

    const entry: CacheEntry = {
      signature,
      embedding,
      response: cloneResponse(response),
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };

    this.entries.push(entry);
    this.pruneExpired();
    this.pruneOverflow();
  }

  clear(): void {
    this.entries = [];
  }

  private pruneExpired(): void {
    const now = Date.now();
    const maxAgeMs = this.config.ttlSeconds * 1000;
    this.entries = this.entries.filter((entry) => now - entry.createdAt <= maxAgeMs);
  }

  private pruneOverflow(): void {
    if (this.entries.length <= this.config.maxSize) return;
    this.entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
    this.entries = this.entries.slice(0, this.config.maxSize);
  }
}

function defaultKeyFunction(request: CompletionRequest): string {
  return stableStringify({
    model: request.model,
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
    topP: request.topP ?? null,
    stop: request.stop ?? null,
    toolChoice: request.toolChoice ?? null,
    tools: request.tools ?? null,
  });
}

const defaultEmbedder: CacheEmbeddingFunction = async (
  input: CacheEmbeddingInput
): Promise<number[]> => {
  const tokens = tokenize(input.text);
  if (tokens.length === 0) {
    return new Array(DEFAULT_EMBEDDING_DIM).fill(0);
  }

  const vector = new Array(DEFAULT_EMBEDDING_DIM).fill(0);
  for (const token of tokens) {
    const index = hashToken(token) % DEFAULT_EMBEDDING_DIM;
    vector[index] += 1;
  }

  return normalizeVector(vector);
};

function buildEmbeddingText(request: CompletionRequest): string {
  return request.messages
    .map((message) => {
      const name = message.name ? `:${message.name}` : '';
      const toolId = message.toolCallId ? `:${message.toolCallId}` : '';
      return `${message.role}${name}${toolId}:${message.content}`;
    })
    .join('\n');
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(',')}}`;
}

function cloneResponse(response: CompletionResponse): CompletionResponse {
  if (typeof structuredClone === 'function') {
    return structuredClone(response);
  }
  return JSON.parse(JSON.stringify(response)) as CompletionResponse;
}
