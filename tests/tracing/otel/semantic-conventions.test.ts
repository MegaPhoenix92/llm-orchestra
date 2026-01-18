/**
 * OTEL semantic conventions tests
 */

import { describe, it, expect } from 'vitest';
import { ATTRIBUTE_MAPPING, mapAttributesToOtel } from '../../../src/tracing/otel/semantic-conventions.js';

describe('semantic conventions', () => {
  it('should_mapLlMAttributesToGenAi', () => {
    const mapped = mapAttributesToOtel({
      'llm.provider': 'anthropic',
      'llm.model': 'claude-3',
      'llm.tokens.input': 10,
      'llm.tokens.output': 20,
      'llm.tokens.total': 30,
      'llm.cost': 0.12,
      'llm.cached': true,
      'custom.attribute': 'value',
    });

    expect(mapped['gen_ai.system']).toBe('anthropic');
    expect(mapped['gen_ai.request.model']).toBe('claude-3');
    expect(mapped['gen_ai.usage.input_tokens']).toBe(10);
    expect(mapped['gen_ai.usage.output_tokens']).toBe(20);
    expect(mapped['gen_ai.usage.total_tokens']).toBe(30);
    expect(mapped['gen_ai.usage.cost']).toBe(0.12);
    expect(mapped['gen_ai.cache.hit']).toBe(true);
    expect(mapped['custom.attribute']).toBe('value');
  });

  it('should_exposeAttributeMappingKeys', () => {
    expect(ATTRIBUTE_MAPPING['llm.provider']).toBe('gen_ai.system');
    expect(ATTRIBUTE_MAPPING['llm.model']).toBe('gen_ai.request.model');
  });
});
