/**
 * OTEL semantic conventions for GenAI attributes
 */

export const ATTRIBUTE_MAPPING: Record<string, string> = {
  'llm.provider': 'gen_ai.system',
  'llm.model': 'gen_ai.request.model',
  'llm.tokens.input': 'gen_ai.usage.input_tokens',
  'llm.tokens.output': 'gen_ai.usage.output_tokens',
  'llm.tokens.total': 'gen_ai.usage.total_tokens',
  'llm.cost': 'gen_ai.usage.cost',
  'llm.cached': 'gen_ai.cache.hit',
};

export function mapAttributesToOtel(
  attributes: Record<string, unknown>
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    mapped[ATTRIBUTE_MAPPING[key] ?? key] = value;
  }
  return mapped;
}
