import type { Drupal } from './engine.js'
import { withoutTrailingSlashes } from './slashes.js'

/** The part of msw's `http` this needs, so msw stays a peer a consumer brings. */
export interface MswHttp<Handler> {
  all: (predicate: string, resolver: (info: { request: Request }) => Promise<Response>) => Handler
}

/**
 * msw request handlers over the engine, for a consumer that intercepts `fetch` or XHR with msw.
 *
 * @example @lang ts
 * import { http } from 'msw'
 * import { setupServer } from 'msw/node'
 * const server = setupServer(...handlers(drupal, http, 'https://drupal.test'))
 */
export const handlers = <Handler>(drupal: Drupal, http: MswHttp<Handler>, baseUrl: string): Handler[] => [
  http.all(`${withoutTrailingSlashes(baseUrl)}/*`, ({ request }) => drupal.fetch(request)),
]
