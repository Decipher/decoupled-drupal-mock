import { compare, createReader, FilterError, parseFilter, passes } from './filter.js'
import { pagedSearch, parseQuery, selfSearch, sortedSearch } from './query.js'
import { keyOf } from './hash.js'
import type { Document, Dump, Recorded, Resource, ResourceIdentifier } from './types.js'

export interface DrupalOptions {
  /** The origin the server answers for, written into every link. Default `https://drupal.invalid`. */
  baseUrl?: string
  /** JSON:API's base path. Default `/jsonapi`. */
  basePath?: string
}

export interface Drupal {
  /** A `fetch` answering as Drupal would. */
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Answers one request, for a transport of your own. */
  handle: (method: string, url: string, headers?: Record<string, string>) => { status: number, headers: Record<string, string>, body: unknown }
  readonly manifest: Dump['manifest']
}

const JSONAPI_DEFAULT = { version: '1.0', meta: { links: { self: { href: 'http://jsonapi.org/format/1.0/' } } } }

/** Drupal's page size, and its cap. */
const PAGE_LIMIT = 50

const INFO: Record<number, string> = { 400: 'https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html#sec10.4.1', 403: 'https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html#sec10.4.4', 404: 'https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html#sec10.4.5', 405: 'https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html#sec10.4.6' }

/** A JSON:API error document as Drupal writes one: `via` is the request, `info` the RFC section. */
const error = (JSONAPI: NonNullable<Document['jsonapi']>, status: number, title: string, detail: string | undefined, via: string, source?: Record<string, string>): Document => ({
  jsonapi: JSONAPI,
  errors: [{ title, status: String(status), ...(detail ? { detail } : {}), links: { via: { href: via }, info: { href: INFO[status] || INFO[404]! } }, ...(source ? { source } : {}) }],
})

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error' }

/**
 * A Drupal JSON:API over a preset's dump.
 *
 * @param dump - The preset build.
 * @param options - The origin and base path to answer for.
 */
export const createDrupal = (dump: Dump, options: DrupalOptions = {}): Drupal => {
  const baseUrl = (options.baseUrl || 'https://drupal.invalid').replace(/\/+$/, '')
  const basePath = options.basePath || '/jsonapi'
  const placeholder = dump.manifest.origin.replace(/\/+$/, '')
  const languages = dump.manifest.languages
  // The `jsonapi` object as the dump's Drupal writes it: the version it speaks.
  const JSONAPI = (dump.index[dump.manifest.defaultLanguage]?.jsonapi || JSONAPI_DEFAULT) as NonNullable<Document['jsonapi']>
  /** Whether the anonymous user may read a resource, and whether it may list a type at all. */
  const accessOf = (langcode: string, type: string) => dump.access?.[langcode]?.[type] ?? dump.access?.[dump.manifest.defaultLanguage]?.[type]
  const forbidden = (langcode: string, type: string): boolean => !!accessOf(langcode, type)?.forbidden
  const visible = (langcode: string, resource: Resource): boolean => {
    const access = accessOf(langcode, resource.type)
    return !access?.visible || access.visible.includes(resource.id)
  }
  /** The resource without the fields the anonymous user may not read, which Drupal leaves out without a word. */
  const readable = (langcode: string, resource: Resource, all: boolean): Resource => {
    const hidden = all ? undefined : accessOf(langcode, resource.type)?.hidden
    if (!hidden?.length) return resource
    const out: Resource = { ...resource }
    const attributes = Object.fromEntries(Object.entries(resource.attributes || {}).filter(([key]) => !hidden.includes(key)))
    const relationships = Object.fromEntries(Object.entries(resource.relationships || {}).filter(([key]) => !hidden.includes(key)))
    // Drupal writes no key for an empty member.
    delete out.attributes
    delete out.relationships
    if (Object.keys(attributes).length) out.attributes = attributes
    if (Object.keys(relationships).length) out.relationships = relationships
    return out
  }
  /** A resource no user reads: in the dump with its data so it filters and sorts as Drupal's, never served. */
  const isPhantom = (langcode: string, resource: Resource): boolean => !!accessOf(langcode, resource.type)?.phantom?.includes(resource.id)
  const individualHref = (prefix: string, resource: Resource): string => `${baseUrl}${prefix}${basePath}/${resource.type.replace('--', '/')}/${resource.id}`
  const omission = (prefix: string, resources: Resource[]) => ({
    detail: 'Some resources have been omitted because of insufficient authorization.',
    links: {
      help: { href: 'https://www.drupal.org/docs/8/modules/json-api/filtering#filters-access-control' },
      ...Object.fromEntries(resources.map((resource) => { const href = individualHref(prefix, resource); return [`item--${keyOf(href)}`, { href, meta: { rel: 'item', detail: 'The current user is not allowed to GET the selected resource.' } }] })),
    },
  })
  /** The resource types the index lists, which answer with an empty collection when the dump holds none. */
  const listed = new Set(Object.keys(dump.index[dump.manifest.defaultLanguage]?.links || {}).filter((key) => key !== 'self'))
  const html404 = (path: string) => ({ status: 404, headers: { 'content-type': 'text/html; charset=UTF-8' }, body: `<!DOCTYPE html><html><body><h1>Page not found</h1><p>The requested page "${path}" could not be found.</p></body></html>` })
  const prefixes = Object.entries(languages).filter(([, prefix]) => prefix).sort((a, b) => b[1].length - a[1].length)

  /** The language and the path after its prefix. */
  const language = (path: string): { langcode: string, prefix: string, rest: string } => {
    for (const [langcode, prefix] of prefixes) {
      if (path === `/${prefix}` || path.startsWith(`/${prefix}/`)) return { langcode, prefix: `/${prefix}`, rest: path.slice(prefix.length + 1) || '/' }
    }
    return { langcode: dump.manifest.defaultLanguage, prefix: '', rest: path }
  }

  /** Every absolute link in the dump points at the placeholder; the server's base URL takes its place. */
  const relink = <T>(value: T): T => JSON.parse(JSON.stringify(value).split(placeholder).join(baseUrl)) as T

  const resourcesOf = (langcode: string, type: string): Resource[] | undefined => dump.resources[langcode]?.[type] ?? dump.resources[dump.manifest.defaultLanguage]?.[type] ?? (listed.has(type) ? [] : undefined)

  /** A resource in a language, or its default translation, as Drupal falls back. */
  const find = (langcode: string, identifier: ResourceIdentifier): Resource | undefined =>
    dump.resources[langcode]?.[identifier.type]?.find((resource) => resource.id === identifier.id)
    ?? dump.resources[dump.manifest.defaultLanguage]?.[identifier.type]?.find((resource) => resource.id === identifier.id)

  const typeOf = (entityType: string, bundle: string): string => `${entityType}--${bundle}`

  /** Sparse fieldsets applied to a resource, after the user's field access. */
  const sparse = (resource: Resource, fields: Record<string, unknown> | undefined, langcode = dump.manifest.defaultLanguage, all = true): Resource => {
    resource = readable(langcode, resource, all)
    const wanted = fields?.[resource.type]
    if (typeof wanted !== 'string') return resource
    const keep = new Set(wanted.split(',').map((name) => name.trim()).filter(Boolean))
    const pick = <T extends Record<string, unknown>>(entries: T | undefined): T | undefined => {
      if (!entries) return undefined
      const picked = Object.fromEntries(Object.entries(entries).filter(([key]) => keep.has(key)))
      return Object.keys(picked).length ? picked as T : undefined
    }
    const out: Resource = { type: resource.type, id: resource.id, ...(resource.links ? { links: resource.links } : {}) }
    const attributes = pick(resource.attributes)
    const relationships = pick(resource.relationships)
    if (attributes) out.attributes = attributes
    if (relationships) out.relationships = relationships
    if (resource.meta) out.meta = resource.meta
    return out
  }

  /** The resources `include` names, in the order they are met, each once. */
  const include = (langcode: string, roots: Resource[], paths: string[], fields: Record<string, unknown> | undefined, all: boolean, omitted: Resource[]): Resource[] => {
    const seen = new Set<string>()
    const included: Resource[] = []
    const walk = (resources: Resource[], path: string[]): void => {
      const [head, ...rest] = path
      if (head === undefined) return
      const next: Resource[] = []
      for (const resource of resources) {
        const relationship = resource.relationships?.[head]
        if (!relationship) continue
        const identifiers = Array.isArray(relationship.data) ? relationship.data : relationship.data ? [relationship.data] : []
        for (const identifier of identifiers) {
          const target = find(langcode, identifier)
          if (!target) continue
          if (isPhantom(langcode, target) || (!all && !visible(langcode, target))) {
            if (!omitted.includes(target)) omitted.push(target)
            continue
          }
          // Walked again along another path, listed once.
          next.push(target)
          const key = `${target.type}:${target.id}`
          if (seen.has(key)) continue
          seen.add(key)
          included.push(sparse(target, fields, langcode, all))
        }
      }
      walk(next, rest)
    }
    for (const path of paths) walk(roots, path.split('.'))
    return included
  }

  const read = (langcode: string) => createReader((identifier) => find(langcode, identifier))

  // C. A recorded route answers unprefixed for the default language, as Drupal does.
  const defaultPrefix = languages[dump.manifest.defaultLanguage] ? `/${languages[dump.manifest.defaultLanguage]}` : ''
  const recorded = (method: string, path: string, search: string): Recorded | undefined => {
    const keys = [`${method} ${path}${search ? `?${sortedSearch(search)}` : ''}`, `${method} ${path}`]
    if (defaultPrefix && !prefixes.some(([, prefix]) => path === `/${prefix}` || path.startsWith(`/${prefix}/`))) keys.push(`${method} ${defaultPrefix}${path}${search ? `?${sortedSearch(search)}` : ''}`, `${method} ${defaultPrefix}${path}`)
    for (const key of keys) if (dump.recorded[key]) return dump.recorded[key]
    return undefined
  }

  const handle: Drupal['handle'] = (method, input, requestHeaders = {}) => {
    // With credentials the whole dump is readable, as an administrator's token reads it from Drupal.
    const all = Object.keys(requestHeaders).some((name) => name.toLowerCase() === 'authorization')
    const url = new URL(input, baseUrl)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const search = url.search.replace(/^\?/, '')
    const query = parseQuery(search)
    const upper = method.toUpperCase()
    const headers = { 'content-type': 'application/vnd.api+json' }

    const hit = recorded(upper, path, search)
    if (hit) {
      const body = relink(hit.body)
      // A JSON:API answer names the request it answered.
      const document = body as { links?: { self?: { href?: string } } } | null
      if (path !== basePath && !path.endsWith(basePath) && document && typeof document === 'object' && document.links?.self?.href && !Array.isArray(document)) document.links.self.href = `${baseUrl}${path}${search ? `?${selfSearch(search)}` : ''}`
      return { status: hit.status, headers: hit.headers, body }
    }
    // Decoupled Router answers for the paths the build recorded, and as itself for the rest.
    if (path === '/router/translate-path') {
      const asked = String((query.path as string | undefined) ?? '')
      return { status: 404, headers: { 'content-type': 'application/json' }, body: { message: `Unable to resolve path ${asked}.`, details: 'None of the available methods were able to find a match for this path.' } }
    }

    const { langcode, prefix, rest } = language(path)
    if (rest !== basePath && !rest.startsWith(`${basePath}/`)) return html404(path)
    const via = `${baseUrl}${prefix}${rest}${search ? `?${search}` : ''}`
    const self = `${baseUrl}${prefix}${rest}${search ? `?${selfSearch(search)}` : ''}`
    if (upper !== 'GET' && upper !== 'HEAD') {
      return { status: 405, headers, body: error(JSONAPI, 405, 'Method Not Allowed', `No route found for "${upper} ${path}": Method Not Allowed (Allow: GET, POST, HEAD)`, via) }
    }

    // The index.
    if (rest === basePath) {
      const index = dump.index[langcode] ?? dump.index[dump.manifest.defaultLanguage]
      return index ? { status: 200, headers, body: relink(index) } : html404(path)
    }

    const segments = rest.slice(basePath.length + 1).split('/').filter(Boolean)
    // JSON:API Menu Items answers from the recordings; a menu it has none for is Drupal's 404.
    if (segments[0] === 'menu_items') {
      return { status: 404, headers, body: error(JSONAPI, 404, 'Not Found', `The "menu" parameter was not converted for the path "${basePath}/menu_items/{menu}" (route name: "jsonapi_menu_items.menu")`, via) }
    }
    const [entityType, bundle, id, related] = segments
    // A path no JSON:API route answers is Drupal's HTML 404, as is a type the index does not list.
    if (!entityType || !bundle) return html404(path)
    const type = typeOf(entityType, bundle)
    const collection = resourcesOf(langcode, type)
    if (!collection) return html404(path)
    if (!all && forbidden(langcode, type)) return { status: 403, headers, body: error(JSONAPI, 403, 'Forbidden', 'The current user is not allowed to GET the selected resource.', via) }
    const fields = query.fields as Record<string, unknown> | undefined
    const includes = typeof query.include === 'string' ? query.include.split(',').map((item) => item.trim()).filter(Boolean) : []

    // One resource, or its related resources.
    if (id) {
      const resource = find(langcode, { type, id })
      if (!resource) return { status: 404, headers, body: error(JSONAPI, 404, 'Not Found', `The "entity" parameter was not converted for the path "${basePath}/${entityType}/${bundle}/{entity}" (route name: "jsonapi.${type}.individual")`, via) }
      if (isPhantom(langcode, resource) || (!all && !visible(langcode, resource))) return { status: 403, headers, body: error(JSONAPI, 403, 'Forbidden', 'The current user is not allowed to GET the selected resource.', via) }
      const omitted: Resource[] = []
      if (related) {
        const relationship = resource.relationships?.[related]
        if (!relationship) return html404(path)
        const identifiers = Array.isArray(relationship.data) ? relationship.data : relationship.data ? [relationship.data] : []
        const found = identifiers.map((identifier) => find(langcode, identifier)).filter((target): target is Resource => !!target)
        const targets = found.filter((target) => !isPhantom(langcode, target) && (all || visible(langcode, target)))
        omitted.push(...found.filter((target) => !targets.includes(target)))
        const data = Array.isArray(relationship.data) ? targets.map((target) => sparse(target, fields, langcode, all)) : targets[0] ? sparse(targets[0], fields, langcode, all) : null
        const document: Document = { jsonapi: JSONAPI, data, links: { self: { href: self } } }
        if (includes.length) document.included = include(langcode, targets, includes, fields, all, omitted)
        if (omitted.length) document.meta = { omitted: omission(prefix, omitted) }
        return { status: 200, headers, body: relink(document) }
      }
      const document: Document = { jsonapi: JSONAPI, data: sparse(resource, fields, langcode, all), links: { self: { href: self } } }
      if (includes.length) document.included = include(langcode, [resource], includes, fields, all, omitted)
      if (omitted.length) document.meta = { omitted: omission(prefix, omitted) }
      return { status: 200, headers, body: relink(document) }
    }

    // A collection.
    let filter
    try {
      filter = parseFilter(query.filter)
    } catch (err) {
      if (err instanceof FilterError) return { status: 400, headers, body: error(JSONAPI, 400, 'Bad Request', err.message, via, { parameter: 'filter' }) }
      throw err
    }
    const reader = read(langcode)
    let matched = collection.filter((resource) => passes(resource, filter, reader))
    const sort = typeof query.sort === 'string' ? query.sort.split(',').map((item) => item.trim()).filter(Boolean) : []
    if (sort.length) {
      const keys = sort.map((item) => ({ path: item.replace(/^-/, '').split('.'), direction: item.startsWith('-') ? -1 : 1 }))
      matched = [...matched].sort((a, b) => {
        for (const { path, direction } of keys) {
          const x = reader(a, path)[0]
          const y = reader(b, path)[0]
          const order = x === y ? 0 : x === undefined || x === null ? -1 : y === undefined || y === null ? 1 : compare(x, y)
          if (order) return order * direction
        }
        return 0
      })
    }
    const page = (query.page || {}) as Record<string, unknown>
    const offset = Math.max(0, Number(page.offset) || 0)
    const limit = Math.min(PAGE_LIMIT, Math.max(1, Number(page.limit) || PAGE_LIMIT))
    // Drupal pages before it checks access, so a resource the user may not read takes its place in the page and is
    // reported as omitted rather than served.
    const page_ = matched.slice(offset, offset + limit)
    const slice = page_.filter((resource) => !isPhantom(langcode, resource) && (all || visible(langcode, resource)))
    const omitted = page_.filter((resource) => !slice.includes(resource))
    const document: Document = { jsonapi: JSONAPI, data: slice.map((resource) => sparse(resource, fields, langcode, all)), links: { self: { href: self } } }
    if (includes.length) document.included = include(langcode, slice, includes, fields, all, omitted)
    if (omitted.length) document.meta = { omitted: omission(prefix, omitted) }
    // Drupal keeps the request's parameters in their order, with page[offset] and page[limit] in page's place.
    const pageLink = (newOffset: number): { href: string } => ({ href: `${baseUrl}${prefix}${rest}?${pagedSearch(search, newOffset, limit)}` })
    if (offset + limit < matched.length) document.links!.next = pageLink(offset + limit)
    if (offset > 0) {
      document.links!.first = pageLink(0)
      document.links!.prev = pageLink(Math.max(0, offset - limit))
    }
    return { status: 200, headers, body: relink(document) }
  }

  const fetch: Drupal['fetch'] = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input instanceof URL ? input.toString() : input, init)
    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, name) => { requestHeaders[name] = value })
    const { status, headers, body } = handle(request.method, request.url, requestHeaders)
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers })
  }

  return { fetch, handle, manifest: dump.manifest }
}
