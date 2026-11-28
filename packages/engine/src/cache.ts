import type { Manifest } from './types.js'

/** The headers the site's cache pair names. */
export const CACHE_HEADERS = ['cache-control', 'vary', 'expires'] as const

const PUBLIC = /\bpublic\b/i
/** What keeps a shared cache from storing an answer to a request with a token or a session (RFC 9111, 3.5). */
const UNSHARED = /\b(private|no-store)\b/i

/**
 * An answer with the cache headers Drupal's FinishResponseSubscriber gives it. A request the page cache may keep, and
 * an answer that is no server error, takes the site's public pair: a JSON:API 400 or 404 for a visitor is kept too.
 * Anything else takes the private pair. A header the answer sets itself stays. For a request with a token or a session,
 * its Cache-Control stays only when it says `private` or `no-store`: anything else, such as `public` or `s-maxage`,
 * lets a shared cache store one user's answer for another.
 *
 * @param cache - The site's pair, from the manifest. Without one the answer is left as it is.
 * @param cacheable - Whether the page cache may keep the request: a GET or HEAD with no token and no session.
 * @param answer - The answer.
 * @returns The answer with its cache headers.
 */
export const withCache = <T extends { status: number, headers: Record<string, string> }>(cache: Manifest['cache'], cacheable: boolean, answer: T): T => {
  if (!cache) return answer
  const own: Record<string, string> = {}
  const rest: Record<string, string> = {}
  for (const [name, value] of Object.entries(answer.headers)) {
    if ((CACHE_HEADERS as readonly string[]).includes(name.toLowerCase())) own[name.toLowerCase()] = value
    else rest[name] = value
  }
  const control = own['cache-control']
  const kept = cacheable && answer.status < 500 && (control === undefined || PUBLIC.test(control))
  const pair = kept ? cache.public : cache.private
  const headers: Record<string, string> = {
    ...rest,
    'cache-control': control !== undefined && ((cacheable && answer.status < 500) || UNSHARED.test(control)) ? control : pair['cache-control']!,
    vary: own.vary ?? pair.vary!,
    expires: own.expires ?? pair.expires!,
  }
  // A site that sends no such header, or an answer that names none, leaves it out.
  for (const name of CACHE_HEADERS) if (!headers[name]) delete headers[name]
  return { ...answer, headers }
}
