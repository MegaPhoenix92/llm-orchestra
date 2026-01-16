/**
 * Provider Registry
 * Central registry for all LLM provider adapters
 */

export { BaseProvider } from './base.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { GoogleProvider } from './google.js';

import type { ProviderAdapter, ProviderName, ProvidersConfig } from '../types/index.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GoogleProvider } from './google.js';

/**
 * Model to provider mapping
 */
const MODEL_PROVIDER_MAP: Record<string, ProviderName> = {
  // Anthropic models
  'claude-3-opus': 'anthropic',
  'claude-3-sonnet': 'anthropic',
  'claude-3-haiku': 'anthropic',
  'claude-3.5-sonnet': 'anthropic',
  'claude-3.5-haiku': 'anthropic',
  'claude-3-opus-20240229': 'anthropic',
  'claude-3-sonnet-20240229': 'anthropic',
  'claude-3-haiku-20240307': 'anthropic',
  'claude-3-5-sonnet-20241022': 'anthropic',
  'claude-3-5-haiku-20241022': 'anthropic',

  // OpenAI models
  'gpt-4': 'openai',
  'gpt-4-turbo': 'openai',
  'gpt-4-turbo-preview': 'openai',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'gpt-3.5-turbo': 'openai',
  'gpt-3.5-turbo-16k': 'openai',

  // Google models
  'gemini-pro': 'google',
  'gemini-pro-vision': 'google',
  'gemini-1.5-pro': 'google',
  'gemini-1.5-flash': 'google',
  'gemini-2.0-flash': 'google',
};

/**
 * Create provider instances from config
 */
export function createProviders(config: ProvidersConfig): Map<ProviderName, ProviderAdapter> {
  const providers = new Map<ProviderName, ProviderAdapter>();

  if (config.anthropic?.apiKey) {
    providers.set('anthropic', new AnthropicProvider(config.anthropic));
  }

  if (config.openai?.apiKey) {
    providers.set('openai', new OpenAIProvider(config.openai));
  }

  if (config.google?.apiKey) {
    providers.set('google', new GoogleProvider(config.google));
  }

  return providers;
}

/**
 * Get provider name for a model
 */
export function getProviderForModel(model: string): ProviderName | undefined {
  // Check exact match first
  if (MODEL_PROVIDER_MAP[model]) {
    return MODEL_PROVIDER_MAP[model];
  }

  // Check prefix patterns
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('gpt')) return 'openai';
  if (model.startsWith('gemini')) return 'google';
  if (model.startsWith('mistral')) return 'mistral';

  return undefined;
}

/**
 * Get all available models for a provider
 */
export function getModelsForProvider(provider: ProviderName): string[] {
  return Object.entries(MODEL_PROVIDER_MAP)
    .filter(([_, p]) => p === provider)
    .map(([model]) => model);
}
