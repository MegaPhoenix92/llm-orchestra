/**
 * Stats Command
 * Display quick summary of Orchestra statistics
 */

import chalk from 'chalk';

interface StatsResponse {
  totalRequests: number;
  totalTokens: { input: number; output: number };
  totalCost: number;
  requestsPerMinute: number;
  uptime: number;
  activeProviders?: string[];
}

export async function statsCommand(serverUrl: string): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/api/stats`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const stats = (await response.json()) as StatsResponse;

    console.log('\n' + chalk.bold.cyan('LLM Orchestra Statistics') + '\n');
    console.log(chalk.gray('-'.repeat(40)));
    
    console.log(chalk.bold('Total Requests:   ') + chalk.green(stats.totalRequests.toLocaleString()));
    console.log(chalk.bold('Input Tokens:     ') + chalk.yellow(stats.totalTokens.input.toLocaleString()));
    console.log(chalk.bold('Output Tokens:    ') + chalk.yellow(stats.totalTokens.output.toLocaleString()));
    console.log(chalk.bold('Total Cost:       ') + chalk.magenta('$' + stats.totalCost.toFixed(4)));
    console.log(chalk.bold('Requests/min:     ') + chalk.blue(stats.requestsPerMinute));
    console.log(chalk.bold('Uptime:           ') + formatUptime(stats.uptime));
    
    console.log(chalk.gray('-'.repeat(40)));
    
    if (stats.activeProviders && stats.activeProviders.length > 0) {
      console.log(chalk.bold('Active Providers: ') + stats.activeProviders.join(', '));
    }
    
    console.log('');
  } catch (error) {
    console.error(chalk.red('Error fetching stats:'), (error as Error).message);
    console.log(chalk.gray('Make sure the dashboard server is running at ' + serverUrl));
    process.exit(1);
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return days + 'd ' + (hours % 24) + 'h';
  if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
  if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
  return seconds + 's';
}
