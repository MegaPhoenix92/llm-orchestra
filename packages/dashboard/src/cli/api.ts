/**
 * CLI API Client
 * Shared HTTP client for CLI commands with cloud authentication support
 */

import chalk from 'chalk';

/**
 * Options for API requests
 */
export interface ApiOptions {
  /** Dashboard server URL */
  server: string;
  /** API key for cloud authentication (optional for local mode) */
  apiKey?: string;
  /** Project ID for multi-tenant queries (required for cloud mode) */
  projectId?: string;
}

/**
 * Create headers for API requests
 */
function createHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Build URL with query parameters, preserving any base path in the server URL
 *
 * Example: buildUrl('https://example.com/orchestra', '/api/stats', {limit: 10})
 * Returns: 'https://example.com/orchestra/api/stats?limit=10'
 */
function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | undefined>
): string {
  // Parse the base URL to extract any existing path
  const base = new URL(baseUrl);

  // Combine base path with API path, avoiding double slashes
  const basePath = base.pathname.replace(/\/$/, ''); // Remove trailing slash
  const apiPath = path.startsWith('/') ? path : '/' + path;
  base.pathname = basePath + apiPath;

  // Add query parameters
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        base.searchParams.set(key, String(value));
      }
    }
  }

  return base.toString();
}

/**
 * Fetch data from the dashboard API
 */
export async function apiFetch<T>(
  options: ApiOptions,
  path: string,
  queryParams?: Record<string, string | number | undefined>
): Promise<T> {
  const url = buildUrl(options.server, path, queryParams);
  const headers = createHeaders(options.apiKey);

  const response = await fetch(url, { headers });

  if (!response.ok) {
    // Try to get error message from response body
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = (await response.json()) as { error?: string; message?: string };
      const bodyError = errorBody.error ?? errorBody.message;
      if (bodyError) {
        errorMessage = bodyError;
      }
    } catch {
      // Ignore JSON parse errors
    }

    throw new ApiError(errorMessage, response.status);
  }

  return response.json() as Promise<T>;
}

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Handle API errors consistently across commands
 */
export function handleApiError(error: unknown, serverUrl: string): never {
  if (error instanceof ApiError) {
    console.error(chalk.red('API Error:'), error.message);

    if (error.statusCode === 401) {
      console.log(chalk.gray('Authentication failed. Check your API key.'));
    } else if (error.statusCode === 403) {
      console.log(chalk.gray('Access denied. Check your API key permissions.'));
    } else if (error.statusCode === 404) {
      console.log(chalk.gray('Resource not found. Check your project ID.'));
    }
  } else {
    console.error(chalk.red('Error:'), (error as Error).message);
    console.log(chalk.gray('Make sure the dashboard server is running at ' + serverUrl));
  }

  process.exit(1);
}

/**
 * Validate cloud options
 * Returns true if in cloud mode (API key provided)
 */
export function validateCloudOptions(options: ApiOptions): boolean {
  const isCloudMode = !!options.apiKey;

  if (isCloudMode && !options.projectId) {
    console.error(chalk.red('Error:'), 'Project ID is required when using API key');
    console.log(chalk.gray('Use --project-id <id> to specify the project'));
    process.exit(1);
  }

  return isCloudMode;
}
