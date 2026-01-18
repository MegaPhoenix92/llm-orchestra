/**
 * Utility functions for the dashboard server
 */

/**
 * Escape JSON for embedding in inline <script> tags to prevent XSS.
 * Escapes </script>, <!-- and <script> patterns that could break out of script context.
 */
export function escapeJsonForScript(data: unknown): string {
  const json = JSON.stringify(data);
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Sanitize a string for use as a CSS class name.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function sanitizeClass(name: string | undefined): string {
  if (!name) return 'unknown';
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}
