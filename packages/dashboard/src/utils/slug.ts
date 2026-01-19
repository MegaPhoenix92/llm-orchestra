/**
 * Slug Generation Utilities
 */

/**
 * Generate a URL-safe slug from a string
 * @param name - The text to convert to a slug
 * @returns URL-safe lowercase slug with hyphens
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
