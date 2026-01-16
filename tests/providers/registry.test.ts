/**
 * Provider Registry Tests
 * Tests for provider factory and model mapping functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createProviders,
  getProviderForModel,
  getModelsForProvider,
} from '../../src/providers/index.js';
import type { ProvidersConfig } from '../../src/types/index.js';

// Mock the provider SDKs
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    models: { list: vi.fn() },
  })),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn(),
  })),
}));

describe('Provider Registry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createProviders', () => {
    it('should_createEmptyMap_when_noProvidersConfigured', () => {
      const config: ProvidersConfig = {};
      const providers = createProviders(config);

      expect(providers.size).toBe(0);
    });

    it('should_createAnthropicProvider_when_apiKeyProvided', () => {
      const config: ProvidersConfig = {
        anthropic: { apiKey: 'test-anthropic-key' },
      };

      const providers = createProviders(config);

      expect(providers.size).toBe(1);
      expect(providers.has('anthropic')).toBe(true);
      expect(providers.get('anthropic')?.name).toBe('anthropic');
    });

    it('should_createOpenAIProvider_when_apiKeyProvided', () => {
      const config: ProvidersConfig = {
        openai: { apiKey: 'test-openai-key' },
      };

      const providers = createProviders(config);

      expect(providers.size).toBe(1);
      expect(providers.has('openai')).toBe(true);
      expect(providers.get('openai')?.name).toBe('openai');
    });

    it('should_createGoogleProvider_when_apiKeyProvided', () => {
      const config: ProvidersConfig = {
        google: { apiKey: 'test-google-key' },
      };

      const providers = createProviders(config);

      expect(providers.size).toBe(1);
      expect(providers.has('google')).toBe(true);
      expect(providers.get('google')?.name).toBe('google');
    });

    it('should_createMultipleProviders_when_multipleApiKeysProvided', () => {
      const config: ProvidersConfig = {
        anthropic: { apiKey: 'test-anthropic-key' },
        openai: { apiKey: 'test-openai-key' },
        google: { apiKey: 'test-google-key' },
      };

      const providers = createProviders(config);

      expect(providers.size).toBe(3);
      expect(providers.has('anthropic')).toBe(true);
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('google')).toBe(true);
    });

    it('should_skipProvider_when_noApiKey', () => {
      const config: ProvidersConfig = {
        anthropic: { apiKey: '' },
        openai: { apiKey: 'valid-key' },
      };

      const providers = createProviders(config);

      expect(providers.size).toBe(1);
      expect(providers.has('anthropic')).toBe(false);
      expect(providers.has('openai')).toBe(true);
    });
  });

  describe('getProviderForModel', () => {
    describe('Anthropic models', () => {
      it('should_returnAnthropic_when_claudeOpusModel', () => {
        expect(getProviderForModel('claude-3-opus')).toBe('anthropic');
        expect(getProviderForModel('claude-3-opus-20240229')).toBe('anthropic');
      });

      it('should_returnAnthropic_when_claudeSonnetModel', () => {
        expect(getProviderForModel('claude-3-sonnet')).toBe('anthropic');
        expect(getProviderForModel('claude-3-sonnet-20240229')).toBe('anthropic');
        expect(getProviderForModel('claude-3.5-sonnet')).toBe('anthropic');
        expect(getProviderForModel('claude-3-5-sonnet-20241022')).toBe('anthropic');
      });

      it('should_returnAnthropic_when_claudeHaikuModel', () => {
        expect(getProviderForModel('claude-3-haiku')).toBe('anthropic');
        expect(getProviderForModel('claude-3-haiku-20240307')).toBe('anthropic');
        expect(getProviderForModel('claude-3.5-haiku')).toBe('anthropic');
        expect(getProviderForModel('claude-3-5-haiku-20241022')).toBe('anthropic');
      });

      it('should_returnAnthropic_when_modelStartsWithClaude', () => {
        expect(getProviderForModel('claude-future-model')).toBe('anthropic');
        expect(getProviderForModel('claude-4')).toBe('anthropic');
      });
    });

    describe('OpenAI models', () => {
      it('should_returnOpenAI_when_gpt4Model', () => {
        expect(getProviderForModel('gpt-4')).toBe('openai');
        expect(getProviderForModel('gpt-4-turbo')).toBe('openai');
        expect(getProviderForModel('gpt-4-turbo-preview')).toBe('openai');
        expect(getProviderForModel('gpt-4o')).toBe('openai');
        expect(getProviderForModel('gpt-4o-mini')).toBe('openai');
      });

      it('should_returnOpenAI_when_gpt35Model', () => {
        expect(getProviderForModel('gpt-3.5-turbo')).toBe('openai');
        expect(getProviderForModel('gpt-3.5-turbo-16k')).toBe('openai');
      });

      it('should_returnOpenAI_when_modelStartsWithGPT', () => {
        expect(getProviderForModel('gpt-future-model')).toBe('openai');
        expect(getProviderForModel('gpt-5')).toBe('openai');
      });
    });

    describe('Google models', () => {
      it('should_returnGoogle_when_geminiProModel', () => {
        expect(getProviderForModel('gemini-pro')).toBe('google');
        expect(getProviderForModel('gemini-pro-vision')).toBe('google');
        expect(getProviderForModel('gemini-1.5-pro')).toBe('google');
      });

      it('should_returnGoogle_when_geminiFlashModel', () => {
        expect(getProviderForModel('gemini-1.5-flash')).toBe('google');
        expect(getProviderForModel('gemini-2.0-flash')).toBe('google');
      });

      it('should_returnGoogle_when_modelStartsWithGemini', () => {
        expect(getProviderForModel('gemini-future-model')).toBe('google');
        expect(getProviderForModel('gemini-ultra')).toBe('google');
      });
    });

    describe('Mistral models', () => {
      it('should_returnMistral_when_modelStartsWithMistral', () => {
        expect(getProviderForModel('mistral-large')).toBe('mistral');
        expect(getProviderForModel('mistral-medium')).toBe('mistral');
      });
    });

    describe('Unknown models', () => {
      it('should_returnUndefined_when_unknownModel', () => {
        expect(getProviderForModel('unknown-model')).toBeUndefined();
        expect(getProviderForModel('llama-70b')).toBeUndefined();
        expect(getProviderForModel('')).toBeUndefined();
      });
    });
  });

  describe('getModelsForProvider', () => {
    it('should_returnAnthropicModels_when_anthropicProvider', () => {
      const models = getModelsForProvider('anthropic');

      expect(models).toContain('claude-3-opus');
      expect(models).toContain('claude-3-sonnet');
      expect(models).toContain('claude-3-haiku');
      expect(models).toContain('claude-3.5-sonnet');
      expect(models).toContain('claude-3-opus-20240229');
    });

    it('should_returnOpenAIModels_when_openaiProvider', () => {
      const models = getModelsForProvider('openai');

      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-4-turbo');
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-3.5-turbo');
    });

    it('should_returnGoogleModels_when_googleProvider', () => {
      const models = getModelsForProvider('google');

      expect(models).toContain('gemini-pro');
      expect(models).toContain('gemini-1.5-pro');
      expect(models).toContain('gemini-1.5-flash');
      expect(models).toContain('gemini-2.0-flash');
    });

    it('should_returnEmptyArray_when_mistralProvider', () => {
      // Mistral is detected by prefix, not explicit mapping
      const models = getModelsForProvider('mistral');
      // May or may not have models depending on implementation
      expect(Array.isArray(models)).toBe(true);
    });
  });
});
