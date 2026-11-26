/**
 * The language Drupal answers a path in. Drupal decodes the path before it reads the prefix, so `/%65s` is Spanish.
 *
 * @param languages - The languages, as `langcode` to URL prefix (`''` for one without a prefix).
 * @param defaultLanguage - The language of a path with no prefix.
 * @param path - The request path.
 * @returns The langcode.
 */
export const answeredIn = (languages: Record<string, string>, defaultLanguage: string, path: string): string => {
  const segment = path.slice(1).split('/')[0]!
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // PHP's urldecode() leaves what it cannot read, so the segment stays as it is.
  }
  return Object.entries(languages).find(([, prefix]) => prefix && prefix === decoded)?.[0] || defaultLanguage
}
