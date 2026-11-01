import { compare, createReader, FilterError, parseFilter, passes, phpBool } from './filter.js'
import { pagedSearch, parseQuery, selfSearch, sortedSearch } from './query.js'
import { keyOf } from './hash.js'
import { own } from './own.js'
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
  // A trailing slash on the base path would make every route an HTML 404.
  const basePath = (options.basePath || '/jsonapi').replace(/\/+$/, '') || '/jsonapi'
  const placeholder = dump.manifest.origin.replace(/\/+$/, '')
  const languages = dump.manifest.languages
  // The `jsonapi` object as the dump's Drupal writes it: the version it speaks.
  const JSONAPI = (dump.index[dump.manifest.defaultLanguage]?.jsonapi || JSONAPI_DEFAULT) as NonNullable<Document['jsonapi']>
  /** Whether the anonymous user may read a resource, and whether it may list a type at all. */
  const accessOf = (langcode: string, type: string) => dump.access?.[langcode]?.[type] ?? dump.access?.[dump.manifest.defaultLanguage]?.[type]
  const forbidden = (langcode: string, type: string): boolean => !!accessOf(langcode, type)?.forbidden
  /**
   * The first field of a filter path the anonymous user may not read, on the collection's type or on a type a
   * relationship in the path reaches, and the path as Drupal names it: `uid.entity:user.mail`.
   */
  const refusedFilter = (langcode: string, type: string, path: string): { field: string, path: string } | undefined => {
    let types = new Set([type])
    const named: string[] = []
    for (const field of path.split('.')) {
      named.push(field)
      if ([...types].some((current) => accessOf(langcode, current)?.hidden?.includes(field))) return { field, path: named.join('.') }
      const next = new Set<string>()
      for (const current of types) {
        for (const resource of dump.resources[langcode]?.[current] || []) {
          const data = resource.relationships?.[field]?.data
          for (const identifier of Array.isArray(data) ? data : data ? [data] : []) next.add(identifier.type)
        }
      }
      if (!next.size) return undefined
      types = next
      named.push(...new Set([...next].map((target) => `entity:${target.split('--')[0]}`)))
    }
    return undefined
  }

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

  /** A type's resources in a language: a resource with no translation there is listed in its default language, as Drupal lists it. */
  const resourcesOf = (langcode: string, type: string): Resource[] | undefined => {
    const translated = dump.resources[langcode]?.[type]
    const defaults = dump.resources[dump.manifest.defaultLanguage]?.[type]
    if (!translated) return defaults ?? (listed.has(type) ? [] : undefined)
    if (!defaults || langcode === dump.manifest.defaultLanguage) return translated
    const byId = new Map(translated.map((resource) => [resource.id, resource]))
    const merged = defaults.map((resource) => byId.get(resource.id) ?? resource)
    const known = new Set(defaults.map((resource) => resource.id))
    return [...merged, ...translated.filter((resource) => !known.has(resource.id))]
  }

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
  /** Drupal writes `included` only when something was included. */
  const withIncluded = (document: Document, included: Resource[]): void => { if (included.length) document.included = included }

  const include = (langcode: string, roots: Resource[], paths: string[], fields: Record<string, unknown> | undefined, all: boolean, omitted: Resource[]): Resource[] => {
    // A compound document lists each resource once: what `data` carries is never included again.
    const seen = new Set<string>(roots.map((resource) => `${resource.type}:${resource.id}`))
    const included: Resource[] = []
    const walk = (resources: Resource[], path: string[]): void => {
      const [head, ...rest] = path
      if (head === undefined) return
      const next: Resource[] = []
      for (const resource of resources) {
        // A relationship the user may not read is walked as if it were not there, and a target of a forbidden type is omitted.
        const relationship = own(readable(langcode, resource, all).relationships, head)
        if (!relationship) continue
        const identifiers = Array.isArray(relationship.data) ? relationship.data : relationship.data ? [relationship.data] : []
        for (const identifier of identifiers) {
          const target = find(langcode, identifier)
          if (!target) continue
          if (isPhantom(langcode, target) || (!all && (!visible(langcode, target) || forbidden(langcode, target.type)))) {
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

  /** A filter's reader, over the stored values: a field the visitor may not read was refused before any is read. */
  const read = (langcode: string) => createReader((identifier) => find(langcode, identifier))

  /** The field names a type has, from its resources: a filter on another is Drupal's 400. */
  const fieldsOf = (langcode: string, type: string): Set<string> => {
    const names = new Set(['id', 'type'])
    for (const resource of resourcesOf(langcode, type) || []) {
      for (const name of Object.keys(resource.attributes || {})) names.add(name)
      for (const name of Object.keys(resource.relationships || {})) names.add(name)
    }
    return names
  }

  // C. A recorded route answers unprefixed for the default language, as Drupal does.
  const defaultPrefix = languages[dump.manifest.defaultLanguage] ? `/${languages[dump.manifest.defaultLanguage]}` : ''
  const recorded = (method: string, path: string, search: string): Recorded | undefined => {
    // A request with a query string answers only from a recording of that query: the unqueried answer is not its answer.
    const keyed = (prefix: string) => `${method} ${prefix}${path}${search ? `?${sortedSearch(search)}` : ''}`
    const keys = [keyed('')]
    if (defaultPrefix && !prefixes.some(([, prefix]) => path === `/${prefix}` || path.startsWith(`/${prefix}/`))) keys.push(keyed(defaultPrefix))
    for (const key of keys) if (dump.recorded[key]) return dump.recorded[key]
    return undefined
  }
  /**
   * JSON:API Menu Items over its path's recording, with the filters the route takes applied as the module applies
   * them: `enabled`, `menu_name`, `parent`, `min_depth` and `max_depth`. A query with another filter is no recording's.
   */
  const menuItems = (method: string, path: string, search: string): Recorded | undefined => {
    if (!/\/menu_items\/[^/]+$/.test(path) || !search) return undefined
    const base = recorded(method, path, '')
    if (!base || base.status !== 200) return undefined
    const query = parseQuery(search)
    const filters = (query.filter || {}) as Record<string, unknown>
    const known = new Set(['enabled', 'menu_name', 'parent', 'min_depth', 'max_depth'])
    if (Object.keys(filters).some((name) => !known.has(name)) || Object.keys(query).some((name) => !['filter', 'fields'].includes(name))) return undefined
    const document = structuredClone(base.body) as { data?: Resource[] }
    let items = document.data || []
    const parentOf = new Map(items.map((item) => [item.id, String((item.attributes as { parent?: string } | undefined)?.parent || '')]))
    const depthOf = (id: string): number => { let depth = 1; let parent = parentOf.get(id) || ''; while (parent) { depth++; parent = parentOf.get(parent) || '' } return depth }
    if (filters.enabled !== undefined) items = items.filter((item) => !!(item.attributes as { enabled?: boolean } | undefined)?.enabled === phpBool(filters.enabled))
    if (filters.menu_name !== undefined) items = items.filter((item) => (item.attributes as { menu_name?: string } | undefined)?.menu_name === undefined || (item.attributes as { menu_name?: string }).menu_name === String(filters.menu_name))
    if (filters.parent !== undefined) { const root = String(filters.parent); const under = (id: string): boolean => { let parent = parentOf.get(id) || ''; while (parent) { if (parent === root) return true; parent = parentOf.get(parent) || '' } return false }; items = items.filter((item) => under(item.id)) }
    if (filters.min_depth !== undefined) items = items.filter((item) => depthOf(item.id) >= Number(filters.min_depth))
    if (filters.max_depth !== undefined) items = items.filter((item) => depthOf(item.id) <= Number(filters.max_depth))
    const fields = query.fields as Record<string, unknown> | undefined
    document.data = items.map((item) => sparse(item, fields))
    return { ...base, body: document }
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

    // A HEAD is answered as its GET is, as Drupal answers it; the transport leaves the body out.
    const lookup = upper === 'HEAD' ? 'GET' : upper
    const hit = recorded(lookup, path, search) ?? menuItems(lookup, path, search)
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
    // Five segments are a relationship route, `.../relationships/{field}`; more than that is no route.
    if (!entityType || !bundle || segments.length > 5 || (segments.length === 5 && segments[3] !== 'relationships')) return html404(path)
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
        const relationship = own(resource.relationships, related)
        if (!relationship) return html404(path)
        // A relationship the user may not read is Drupal's 403, not a missing route.
        if (!all && accessOf(langcode, resource.type)?.hidden?.includes(related)) return { status: 403, headers, body: error(JSONAPI, 403, 'Forbidden', 'The current user is not allowed to view this relationship.', via) }
        const identifiers = Array.isArray(relationship.data) ? relationship.data : relationship.data ? [relationship.data] : []
        const found = identifiers.map((identifier) => find(langcode, identifier)).filter((target): target is Resource => !!target)
        const targets = found.filter((target) => !isPhantom(langcode, target) && (all || (visible(langcode, target) && !forbidden(langcode, target.type))))
        omitted.push(...found.filter((target) => !targets.includes(target)))
        const data = Array.isArray(relationship.data) ? targets.map((target) => sparse(target, fields, langcode, all)) : targets[0] ? sparse(targets[0], fields, langcode, all) : null
        const document: Document = { jsonapi: JSONAPI, data, links: { self: { href: self } } }
        if (includes.length) withIncluded(document, include(langcode, targets, includes, fields, all, omitted))
        if (omitted.length) document.meta = { omitted: omission(prefix, omitted) }
        return { status: 200, headers, body: relink(document) }
      }
      const document: Document = { jsonapi: JSONAPI, data: sparse(resource, fields, langcode, all), links: { self: { href: self } } }
      if (includes.length) withIncluded(document, include(langcode, [resource], includes, fields, all, omitted))
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
    // A type with no resource to read its fields from takes any filter, as nothing can be known of its fields. A
    // field the visitor may not read is not one the visitor may filter by: Drupal's filter access refuses it.
    const fieldNames = fieldsOf(langcode, type)
    for (const condition of Object.values(filter.conditions)) {
      const [head] = condition.path.split('.')
      // Drupal names the request in the sorted form here, as it names a collection's self link.
      const refused = all ? undefined : refusedFilter(langcode, type, condition.path)
      if (refused) return { status: 403, headers, body: error(JSONAPI, 403, 'Forbidden', `The current user is not authorized to filter by the \`${refused.field}\` field, given in the path \`${refused.path}\`.`, self) }
      if (head && fieldNames.size > 2 && !fieldNames.has(head)) return { status: 400, headers, body: error(JSONAPI, 400, 'Bad Request', `Invalid nested filtering. The field \`${head}\`, given in the path \`${condition.path}\`, does not exist.`, via, { parameter: 'filter' }) }
    }
    const reader = read(langcode)
    let matched = collection.filter((resource) => passes(resource, filter, reader))
    const sort = typeof query.sort === 'string' ? query.sort.split(',').map((item) => item.trim()).filter(Boolean) : []
    if (sort.length) {
      const keys = sort.map((item) => ({ path: item.replace(/^-/, '').split('.'), direction: item.startsWith('-') ? -1 : 1 }))
      const sortReader = read(dump.manifest.defaultLanguage)
      const sortBase = (resource: Resource): Resource => find(dump.manifest.defaultLanguage, resource) || resource
      matched = [...matched].sort((a, b) => {
        for (const { path, direction } of keys) {
          // Drupal sorts on the default language's values, whatever language the list is in.
          const x = sortReader(sortBase(a), path)[0]
          const y = sortReader(sortBase(b), path)[0]
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
    if (includes.length) withIncluded(document, include(langcode, slice, includes, fields, all, omitted))
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
    // `init` applies to a Request too, as it does in the browser's fetch.
    const request = new Request(input instanceof URL ? input.toString() : input, init)
    const requestHeaders: Record<string, string> = {}
    request.headers.forEach((value, name) => { requestHeaders[name] = value })
    const { status, headers, body } = handle(request.method, request.url, requestHeaders)
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    // A HEAD response carries no body.
    return new Response(request.method === 'HEAD' ? null : text, { status, statusText: STATUS_TEXT[status] ?? '', headers })
  }

  return { fetch, handle, manifest: dump.manifest }
}
