/**
 * Tool Use Example
 *
 * This example demonstrates how to use LLM Orchestra with
 * function calling / tool use across different providers.
 *
 * Run with: npx tsx examples/tool-use.ts
 */

import { Orchestra } from 'llm-orchestra';
import type { ToolDefinition } from 'llm-orchestra';

// Define tools that the AI can use
const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name, e.g., "San Francisco, CA"',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit',
          },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
        },
        required: ['query'],
      },
    },
  },
];

// Mock tool implementations
function executeTools(toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>) {
  return toolCalls.map((call) => {
    const args = JSON.parse(call.function.arguments);

    switch (call.function.name) {
      case 'get_weather':
        return {
          toolCallId: call.id,
          result: JSON.stringify({
            location: args.location,
            temperature: 72,
            unit: args.unit || 'fahrenheit',
            condition: 'sunny',
            humidity: 45,
          }),
        };

      case 'search_web':
        return {
          toolCallId: call.id,
          result: JSON.stringify({
            query: args.query,
            results: [
              { title: 'Result 1', snippet: 'First search result...' },
              { title: 'Result 2', snippet: 'Second search result...' },
            ],
          }),
        };

      default:
        return {
          toolCallId: call.id,
          result: JSON.stringify({ error: 'Unknown tool' }),
        };
    }
  });
}

async function main() {
  const orchestra = new Orchestra({
    providers: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
      },
    },
    observability: {
      tracing: {
        enabled: true,
        sampleRate: 1.0,
      },
    },
  });

  console.log('--- Tool Use Example ---\n');

  // Initial request with tools
  const messages: Array<{ role: string; content?: string; toolResults?: Array<{ toolCallId: string; result: string }> }> = [
    {
      role: 'user',
      content: 'What\'s the weather like in San Francisco and New York?',
    },
  ];

  console.log('User:', messages[0].content);
  console.log('\nSending request with tools...');

  let response = await orchestra.complete({
    model: 'claude-3-haiku-20240307',
    messages: messages as any,
    tools,
  });

  // Handle tool calls in a loop
  while (response.toolCalls && response.toolCalls.length > 0) {
    console.log('\nAI wants to use tools:');
    response.toolCalls.forEach((call) => {
      console.log(`  - ${call.function.name}(${call.function.arguments})`);
    });

    // Execute the tools
    const results = executeTools(response.toolCalls);
    console.log('\nTool results:');
    results.forEach((r) => {
      console.log(`  - ${r.toolCallId}: ${r.result.substring(0, 60)}...`);
    });

    // Add assistant message and tool results to conversation
    messages.push({
      role: 'assistant',
      content: response.content || '',
    });

    // Add tool results as a single message
    messages.push({
      role: 'tool_result',
      toolResults: results,
    });

    // Continue the conversation
    console.log('\nContinuing conversation with tool results...');
    response = await orchestra.complete({
      model: 'claude-3-haiku-20240307',
      messages: messages as any,
      tools,
    });
  }

  console.log('\nFinal response:');
  console.log(response.content);

  console.log('\n--- Stats ---');
  const stats = orchestra.getStats();
  console.log('Total requests:', stats.totalRequests);
  console.log('Total cost: $' + stats.totalCost.toFixed(6));

  await orchestra.shutdown();
}

main().catch(console.error);
