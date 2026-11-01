import type { Drupal } from './engine.js'

/** The part of msw's `http` this needs, so msw stays a peer a consumer brings. */
export interface MswHttp {
  all: (predicate: string, resolver: (info: { request: Request }) => Promise<Response>) => unknown
}

/**
 * msw request handlers over the engine, for a consumer that intercepts `fetch` or XHR with msw.
 *
 * @example @lang ts
 * import { http } from 'msw'
 * import { setupServer } from 'msw/node'
 * const server = setupServer(...handlers(drupal, http, 'https://drupal.test'))
 */
export const handlers = (drupal: Drupal, http: MswHttp, baseUrl: string): unknown[] => [
  http.all(`${baseUrl.replace(/\/+$/, '')}/*`, ({ request }) => drupal.fetch(request)),
]
