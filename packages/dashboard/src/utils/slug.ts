/**
 * Slug Generation Utilities
 */

/**
 * Generate a URL-safe slug from a string
 * @param name - The text to convert to a slug
 * @param maxLength - Maximum length of the slug (default: 50)
 * @returns URL-safe lowercase slug with hyphens, truncated to maxLength
 */
export function generateSlug(name: string, maxLength: number = 50): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLength);
}
