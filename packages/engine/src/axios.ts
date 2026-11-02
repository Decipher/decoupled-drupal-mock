import type { Drupal } from './engine.js'
import { withoutTrailingSlashes } from './slashes.js'

/** The parts of an axios request config the engine reads. */
export interface AxiosLikeConfig {
  url?: string | undefined
  baseURL?: string | undefined
  method?: string | undefined
  data?: unknown
  headers?: unknown
  params?: unknown
  validateStatus?: ((status: number) => boolean) | null | undefined
}

/** An axios response, as a client reads it. */
export interface AxiosLikeResponse {
  data: unknown
  status: number
  statusText: string
  headers: Record<string, string>
  config: AxiosLikeConfig
  request: Record<string, never>
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Content' }

const headersOf = (headers: unknown): Record<string, string> => {
  const own = headers && typeof (headers as { toJSON?: unknown }).toJSON === 'function' ? (headers as { toJSON: () => unknown }).toJSON() : headers
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries((own || {}) as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') out[name.toLowerCase()] = String(value)
  }
  return out
}

// As axios 1.x writes params and form bodies: `filter[status]=1` for a nested object, `id[]=1&id[]=2` for an array,
// a date as ISO 8601, and nothing for undefined or null.
const pairsOf = (value: unknown, name: string, out: [string, string][] = []): [string, string][] => {
  if (value === undefined || value === null) return out
  if (value instanceof Date) out.push([name, value.toISOString()])
  else if (Array.isArray(value)) for (const item of value) pairsOf(item, `${name}[]`, out)
  else if (typeof value === 'object') for (const [key, item] of Object.entries(value)) pairsOf(item, `${name}[${key}]`, out)
  else out.push([name, String(value)])
  return out
}

const encode = (values: unknown): string => new URLSearchParams(Object.entries((values || {}) as Record<string, unknown>).flatMap(([name, value]) => pairsOf(value, name))).toString()

const urlOf = (config: AxiosLikeConfig, fallback: string): string => {
  const url = config.url || ''
  const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `${withoutTrailingSlashes(config.baseURL || fallback)}/${url.replace(/^\/+/, '')}`
  const params = encode(config.params)
  return params ? `${full}${full.includes('?') ? '&' : '?'}${params}` : full
}

/**
 * Answers an axios request config from the engine, as axios's own adapters do: a response, or an error carrying it
 * when `validateStatus` turns the status down.
 *
 * @param drupal - The engine.
 * @param config - The request.
 * @param baseUrl - The site a relative URL is read against, when the config names no `baseURL`.
 * @returns The response.
 */
export const answerAxios = async (drupal: Drupal, config: AxiosLikeConfig, baseUrl = 'http://drupal.test'): Promise<AxiosLikeResponse> => {
  const requestHeaders = headersOf(config.headers)
  const method = (config.method || 'get').toUpperCase()
  // An object for a form body is encoded as one, as axios does: the token route reads its grant that way.
  const form = (requestHeaders['content-type'] || '').toLowerCase().startsWith('application/x-www-form-urlencoded')
  const body = config.data === undefined || config.data === null || typeof config.data === 'string' ? config.data as string | undefined | null : form ? encode(config.data) : JSON.stringify(config.data)
  const answered = drupal.handle(method, urlOf(config, baseUrl), requestHeaders, body ?? undefined)
  const { status, headers } = answered
  // A HEAD answer carries no body, as the transport leaves it out.
  const data = method === 'HEAD' ? '' : answered.body
  const response: AxiosLikeResponse = { data, status, statusText: STATUS_TEXT[status] || '', headers, config, request: {} }
  const valid = config.validateStatus === null || (config.validateStatus || ((code: number) => code >= 200 && code < 300))(status)
  if (valid) return response
  throw Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, config, response, code: status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST' })
}

/**
 * An axios adapter over the engine, for a client that takes one: `axios.create({ adapter: axiosAdapter(drupal) })`.
 *
 * @param drupal - The engine.
 * @param baseUrl - The site a relative URL is read against, when the config names no `baseURL`.
 * @returns The adapter.
 */
export const axiosAdapter = (drupal: Drupal, baseUrl?: string) => (config: AxiosLikeConfig): Promise<AxiosLikeResponse> => answerAxios(drupal, config, baseUrl)

/**
 * The verbs of an axios instance over the engine, for a suite that replaces axios with spies and needs something to
 * answer them: `mockAxios.get = jest.fn(verbs.get)`. Assertions on the calls keep working, and the answers are the
 * site's.
 *
 * @param drupal - The engine.
 * @param baseUrl - The site a relative URL is read against, when the config names no `baseURL`.
 * @returns The verbs.
 */
export const axiosVerbs = (drupal: Drupal, baseUrl?: string) => {
  const read = (method: string) => (url: string, config: AxiosLikeConfig = {}) => answerAxios(drupal, { ...config, method, url }, baseUrl)
  const write = (method: string) => (url: string, data?: unknown, config: AxiosLikeConfig = {}) => answerAxios(drupal, { ...config, method, url, data }, baseUrl)
  return { get: read('get'), head: read('head'), delete: read('delete'), options: read('options'), post: write('post'), put: write('put'), patch: write('patch') }
}
