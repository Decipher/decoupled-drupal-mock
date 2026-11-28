import type { Manifest } from './types.js'

/** The headers the site's cache pair names. */
export const CACHE_HEADERS = ['cache-control', 'vary', 'expires'] as const

/** A Cache-Control's directives, in lower case and whole: `private="Set-Cookie"` stays itself, and is not `private`. */
const directives = (control: string): string[] => control.split(',').map((directive) => directive.trim().toLowerCase())

/** Whether a Cache-Control lets a shared cache keep the answer. */
export const isPublic = (control: string): boolean => directives(control).includes('public')

/**
 * Whether a Cache-Control keeps every shared cache from storing the answer to a request with a token or a session
 * (RFC 9111, 3.5): `no-store`, or `private` for the whole answer. A `private` that names a header covers that header.
 */
const unshared = (control: string): boolean => directives(control).some((directive) => directive === 'no-store' || directive === 'private')

/**
 * An answer with the cache headers Drupal's FinishResponseSubscriber gives it. A request the page cache may keep, and
 * an answer that is no server error, takes the site's public pair: a JSON:API 400 or 404 for a visitor is kept too.
 * Anything else takes the private pair. A header the answer sets itself stays. For a request with a token or a session,
 * its Cache-Control stays only when it says `no-store` or `private` for the whole answer: anything else, such as
 * `public` or `s-maxage`, lets a shared cache store one user's answer for another.
 *
 * @param cache - The site's pair, from the manifest. Without one the answer is left as it is.
 * @param cacheable - Whether the page cache may keep the request: a GET or HEAD with no token and no session.
 * @param answer - The answer.
 * @param fill - Whether to give a header the answer has none of from the pair. An answer the engine already gave its
 *   headers has left out the ones its route did not send, so a second pass keeps them out.
 * @returns The answer with its cache headers.
 */
export const withCache = <T extends { status: number, headers: Record<string, string> }>(cache: Manifest['cache'], cacheable: boolean, answer: T, fill = true): T => {
  if (!cache) return answer
  const own: Record<string, string> = {}
  const rest: Record<string, string> = {}
  for (const [name, value] of Object.entries(answer.headers)) {
    if ((CACHE_HEADERS as readonly string[]).includes(name.toLowerCase())) own[name.toLowerCase()] = value
    else rest[name] = value
  }
  const control = own['cache-control']
  const kept = cacheable && answer.status < 500 && (control === undefined || isPublic(control))
  const pair = kept ? cache.public : cache.private
  const stays = control !== undefined && ((cacheable && answer.status < 500) || unshared(control))
  const headers: Record<string, string> = {
    ...rest,
    'cache-control': stays ? control : (control !== undefined || fill ? pair['cache-control']! : ''),
    vary: own.vary ?? (fill ? pair.vary! : ''),
    expires: own.expires ?? (fill ? pair.expires! : ''),
  }
  // A site that sends no such header, or an answer that names none, leaves it out.
  for (const name of CACHE_HEADERS) if (!headers[name]) delete headers[name]
  return { ...answer, headers }
}
