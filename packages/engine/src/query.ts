import { UNSAFE_KEYS } from './own.js'

/** Drupal's bracket query, `filter[a][b]=c`, parsed into nested objects, with repeated keys as arrays. */
export type Query = Record<string, unknown>

/** The most segments a key may have: Drupal's deepest, `filter[x][condition][value][]`, has five. */
const MAX_DEPTH = 8

const set = (target: Record<string, unknown>, path: string[], value: string): void => {
  const [head, ...rest] = path
  // A key that would reach the prototype is dropped, so no request writes into every later one.
  if (head === undefined || UNSAFE_KEYS.has(head)) return
  // `value[]=a&value[]=b` appends; a repeated key does the same.
  if (!rest.length || (rest.length === 1 && rest[0] === '')) {
    const current = target[head]
    target[head] = current === undefined ? (rest.length ? [value] : value) : Array.isArray(current) ? [...current, value] : [current, value]
    return
  }
  const next = target[head]
  const child = next && typeof next === 'object' && !Array.isArray(next) ? next as Record<string, unknown> : {}
  target[head] = child
  set(child, rest, value)
}

/** Parses a query string into Drupal's nested shape. */
export const parseQuery = (search: string): Query => {
  const query: Query = {}
  for (const [key, value] of new URLSearchParams(search)) {
    const path = key.replace(/\]/g, '').split('[', MAX_DEPTH + 1)
    // A key deeper than any Drupal reads is dropped, so no request can recurse the parser out of its stack.
    if (path.length > MAX_DEPTH) continue
    set(query, path, value)
  }
  return query
}

/** A nested query back to Drupal's string form, brackets and spaces encoded as PHP's rawurlencode writes them. */
const build = (value: unknown, prefix: string, out: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => build(item, `${prefix}[${index}]`, out))
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) build(item, prefix ? `${prefix}[${key}]` : key, out)
  } else {
    out.push(`${encode(prefix)}=${encode(String(value))}`)
  }
}

const encode = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** A document's `links.self` query as Drupal writes it: the top-level parameters sorted by name, each one's inner order kept. */
export const selfSearch = (search: string): string => {
  const query = parseQuery(search)
  const out: string[] = []
  for (const key of Object.keys(query).sort()) build(query[key], key, out)
  return out.join('&')
}

/** A collection's `links.next` and `links.prev` query: the request's order, with the page in page's place. */
export const pagedSearch = (search: string, offset: number, limit: number): string => {
  const query = parseQuery(search)
  const page = { offset: String(offset), limit: String(limit) }
  const ordered: Record<string, unknown> = 'page' in query ? Object.fromEntries(Object.entries(query).map(([key, value]) => [key, key === 'page' ? page : value])) : { ...query, page }
  const out: string[] = []
  for (const [key, value] of Object.entries(ordered)) build(value, key, out)
  return out.join('&')
}

/** The query pairs sorted by key, as Drupal writes a document's `links.self`. */
export const sortedSearch = (search: string): string => {
  const pairs = [...new URLSearchParams(search)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return new URLSearchParams(pairs).toString().replace(/\+/g, '%20')
}
