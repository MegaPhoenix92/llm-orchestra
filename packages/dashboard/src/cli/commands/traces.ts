/**
 * CLI command: traces
 * List and view traces
 */

import Table from 'cli-table3';
import chalk from 'chalk';
import type { TraceListItem, TraceDetail } from '../../connectors/types.js';
import { fetchTraces, fetchTraceDetail } from '../utils/api.js';

interface TracesOptions {
  limit?: number;
  status?: string;
  provider?: string;
}

export { fetchTraces, fetchTraceDetail };

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'ok':
      return chalk.green('●');
    case 'error':
      return chalk.red('●');
    default:
      return chalk.gray('●');
  }
}

function getProviderColor(provider: string): (text: string) => string {
  switch (provider) {
    case 'anthropic':
      return chalk.hex('#d97706');
    case 'openai':
      return chalk.hex('#10a37f');
    case 'google':
      return chalk.hex('#4285f4');
    case 'mistral':
      return chalk.hex('#ff7000');
    default:
      return chalk.gray;
  }
}

export function displayTraces(traces: TraceListItem[]): void {
  console.log(chalk.bold('\n🎼 LLM Orchestra Traces\n'));

  if (traces.length === 0) {
    console.log(chalk.yellow('No traces found.'));
    return;
  }

  const table = new Table({
    head: ['Status', 'Name', 'Provider', 'Model', 'Duration', 'Tokens', 'Cost', 'Time'],
    colWidths: [8, 25, 12, 25, 12, 15, 10, 12],
    wordWrap: true,
  });

  for (const trace of traces) {
    table.push([
      getStatusIcon(trace.status),
      trace.name,
      trace.provider
        ? getProviderColor(trace.provider)(trace.provider)
        : '-',
      trace.model || '-',
      formatDuration(trace.duration),
      trace.tokens
        ? `${trace.tokens.input}→${trace.tokens.output}`
        : '-',
      trace.cost !== undefined ? `$${trace.cost.toFixed(4)}` : '-',
      formatTime(trace.startTime),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\nShowing ${traces.length} traces\n`));
}

export function displayTraceDetail(detail: TraceDetail): void {
  console.log(chalk.bold(`\n🎼 Trace: ${detail.traceId}\n`));

  console.log(chalk.cyan('Summary'));
  console.log(`  Total Duration: ${formatDuration(detail.totalDuration)}`);
  console.log(`  Spans: ${detail.spans.length}`);
  console.log('');

  console.log(chalk.cyan('Span Hierarchy'));

  function printSpan(
    spanId: string | undefined,
    depth: number
  ): void {
    const children = spanId
      ? detail.spans.filter((s) => s.context.parentSpanId === spanId)
      : detail.spans.filter(
          (s) =>
            !s.context.parentSpanId ||
            !detail.spans.find(
              (p) => p.context.spanId === s.context.parentSpanId
            )
        );

    for (const span of children) {
      const indent = '  '.repeat(depth);
      const status = getStatusIcon(span.status);
      const duration = formatDuration(
        (span.endTime ?? Date.now()) - span.startTime
      );

      console.log(`${indent}${status} ${chalk.bold(span.name)} (${duration})`);

      const provider = span.attributes['llm.provider'] as string | undefined;
      const model = span.attributes['llm.model'] as string | undefined;

      if (provider && model) {
        console.log(
          `${indent}  ${getProviderColor(provider)(provider)} | ${model}`
        );
      }

      const tokensIn = span.attributes['llm.tokens.input'] as number | undefined;
      const tokensOut = span.attributes['llm.tokens.output'] as number | undefined;
      const cost = span.attributes['llm.cost'] as number | undefined;

      if (tokensIn !== undefined && tokensOut !== undefined) {
        let info = `${indent}  Tokens: ${tokensIn}→${tokensOut}`;
        if (cost !== undefined) {
          info += ` | Cost: $${cost.toFixed(4)}`;
        }
        console.log(chalk.gray(info));
      }

      printSpan(span.context.spanId, depth + 1);
    }
  }

  printSpan(undefined, 1);
  console.log('');
}

export async function tracesCommand(
  serverUrl: string,
  traceId?: string,
  options: TracesOptions = {}
): Promise<void> {
  try {
    if (traceId) {
      const detail = await fetchTraceDetail(serverUrl, traceId);
      displayTraceDetail(detail);
    } else {
      const { traces } = await fetchTraces(serverUrl, options);
      displayTraces(traces);
    }
  } catch (error) {
    console.error(
      chalk.red('Error:'),
      error instanceof Error ? error.message : 'Failed to fetch traces'
    );
    console.log(chalk.yellow('Make sure the dashboard server is running.'));
    process.exit(1);
  }
}
