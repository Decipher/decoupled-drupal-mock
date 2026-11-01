import { buildSchema, executeSync, GraphQLError, parse, validate } from 'graphql'
import type { GraphQLSchema } from 'graphql'
import { createDrupal as createCore, fetchOver } from './engine.js'
import type { Drupal, DrupalOptions, Internals } from './engine.js'
import type { ComposeField, ComposeMeta, ComposeType, Dump, Recorded, Resource, ResourceIdentifier } from './types.js'

/**
 * `decoupled-drupal-mock/graphql`: GraphQL Compose over the same dump. `createDrupal()` here answers everything the
 * engine answers, and the schema's endpoint besides, with the queries resolved from the dump as Drupal resolves them
 * from its database: entity types from the resources, `route` from the recorded Decoupled Router answers, `menu`
 * from the recorded menu items, connections by Compose's cursor rules.
 *
 * @example @lang ts
 * import { createDrupal } from 'decoupled-drupal-mock/graphql'
 * const drupal = createDrupal(umami(), { baseUrl: 'https://drupal.test' })
 * await drupal.fetch('https://drupal.test/graphql', { method: 'POST', body: JSON.stringify({ query: '{ info { version } }' }) })
 */
export const createDrupal = (dump: Dump, options: DrupalOptions = {}): Drupal => {
  const core = createCore(dump, options)
  if (!dump.graphql) return core
  const graphql = createGraphql(core.internals)
  const handle: Drupal['handle'] = (method, url, headers, body) => graphql.handle(method, url, headers, body) ?? core.handle(method, url, headers, body)
  return { ...core, handle, fetch: fetchOver(handle) }
}

/** An error Drupal reports with its message: Compose's `UserError`. */
export class UserError extends Error {}

type Answer = { status: number, headers: Record<string, string>, body: unknown }
type Attributes = Record<string, unknown>

/** PHP's `json_encode` as Drupal's `Json::encode` runs it: slashes, HTML-sensitive characters and non-ASCII escaped. */
const phpJson = (value: unknown): string => JSON.stringify(value)
  .replace(/\//g, '\\/')
  .replace(/[<>&']/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`)
  .replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)

const CANONICAL: Record<string, (attributes: Attributes) => string> = {
  node: (a) => `/node/${a.drupal_internal__nid}`,
  taxonomy_term: (a) => `/taxonomy/term/${a.drupal_internal__tid}`,
  media: (a) => `/media/${a.drupal_internal__mid}/edit`,
  user: (a) => `/user/${a.drupal_internal__uid}`,
  block_content: (a) => `/admin/content/block/${a.drupal_internal__id}`,
}

const LABEL: Record<string, string> = { node: 'title', taxonomy_term: 'name', media: 'name', user: 'name', block_content: 'info', menu_link_content: 'title' }

const INTERNAL_ID: Record<string, string> = { node: 'drupal_internal__nid', taxonomy_term: 'drupal_internal__tid', media: 'drupal_internal__mid', user: 'drupal_internal__uid', block_content: 'drupal_internal__id', file: 'drupal_internal__fid' }

/** GraphQL Compose's answers over the engine's internals. */
export const createGraphql = (internals: Internals): { handle: (method: string, url: string, headers?: Record<string, string>, body?: string) => Answer | undefined, schema: GraphQLSchema } => {
  const { dump, baseUrl } = internals
  const compose: ComposeMeta = dump.graphql!.compose
  const schema = buildSchema(dump.graphql!.schema)
  const settings = (compose.settings || {}) as { schema_description?: string, schema_version?: string, edge_max_limit?: number, exclude_unpublished?: boolean }
  const languages = dump.manifest.languages
  const defaultLanguage = dump.manifest.defaultLanguage
  const timezone = compose.timezone || 'UTC'
  const endpoint = compose.endpoint || '/graphql'
  const typesByType = new Map(Object.entries(compose.types).map(([resourceType, meta]) => [resourceType, meta] as const))
  const menusByEnum = new Map(Object.entries(compose.menus || {}).map(([name, meta]) => [meta.enum, name] as const))

  const prefixOf = (langcode: string): string => (languages[langcode] ? `/${languages[langcode]}` : '')
  const attributesOf = (resource: Resource | undefined): Attributes => (resource?.attributes || {}) as Attributes
  const entityTypeOf = (resource: Resource): string => resource.type.split('--')[0]!
  const labelOf = (resource: Resource): string => String(attributesOf(resource)[LABEL[entityTypeOf(resource)] || 'title'] ?? '')
  const readable = (langcode: string, resource: Resource): boolean => internals.visible(langcode, resource) && !internals.phantom(langcode, resource)

  /** A resource in a language, or its default translation, when a visitor may read it. */
  const translated = (langcode: string, identifier: ResourceIdentifier): Resource | undefined => {
    const resource = internals.find(langcode, identifier)
    return resource && readable(langcode, resource) ? resource : undefined
  }

  /** The canonical path of a resource in a language: its alias, else its route, under the language's prefix. */
  const pathOf = (resource: Resource, langcode: string): string | null => {
    const attributes = attributesOf(resource)
    const alias = (attributes.path as { alias?: string | null } | undefined)?.alias
    const canonical = alias || CANONICAL[entityTypeOf(resource)]?.(attributes)
    // Drupal's URL generator percent-encodes what is not ASCII.
    return canonical ? encodeURI(`${prefixOf(langcode)}${canonical}`) : null
  }

  /** The languages a resource exists in, in the dump's order. */
  const languagesOf = (resource: Resource): string[] => Object.keys(languages).filter((langcode) => internals.stored(langcode, resource.type).some((candidate) => candidate.id === resource.id))

  const languageObject = (langcode: string, context: string) => {
    const configured = internals.stored(defaultLanguage, 'configurable_language--configurable_language').find((candidate) => attributesOf(candidate).drupal_internal__id === langcode)
    return { id: langcode, name: compose.languages?.[context]?.[langcode] ?? (attributesOf(configured).label as string | undefined) ?? langcode, direction: (attributesOf(configured).direction as string | undefined) ?? 'ltr' }
  }

  /** Compose's DateTime, in the site's time zone. */
  const dateTime = (value: unknown) => {
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(String(value))
    const timestamp = Math.floor(date.getTime() / 1000)
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset' }).formatToParts(date).map((part) => [part.type, part.value]))
    const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName!.replace('GMT', '').replace(/^([+-]\d)(?=:)/, '$10').replace(/^([+-]\d{2})$/, '$1:00')
    return { timestamp, timezone, offset, time: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}` }
  }

  const text = (value: unknown, summary: boolean, required: boolean) => {
    if (value === null || value === undefined) return required ? { value: null, processed: '', format: null, ...(summary ? { summary: '' } : {}) } : null
    const item = value as { value?: string | null, format?: string | null, processed?: string | null, summary?: string | null }
    return { value: item.value ?? null, processed: item.processed ?? '', format: item.format ?? null, ...(summary ? { summary: item.summary ?? '' } : {}) }
  }

  const image = (langcode: string, relationship: { data?: ResourceIdentifier | ResourceIdentifier[] | null } | undefined) => {
    const data = Array.isArray(relationship?.data) ? relationship.data[0] : relationship?.data
    if (!data) return null
    const file = internals.find(langcode, data)
    if (!file) return null
    const attributes = attributesOf(file)
    const meta = (data.meta || {}) as { alt?: string | null, title?: string | null, width?: number, height?: number }
    return { url: `${baseUrl}${(attributes.uri as { url?: string } | undefined)?.url || ''}`, width: meta.width || 0, height: meta.height || 0, alt: meta.alt || null, title: meta.title || null, size: Number(attributes.filesize || 0), mime: (attributes.filemime as string | undefined) ?? null }
  }

  const file = (langcode: string, relationship: { data?: ResourceIdentifier | ResourceIdentifier[] | null } | undefined) => {
    const data = Array.isArray(relationship?.data) ? relationship.data[0] : relationship?.data
    if (!data) return null
    const found = internals.find(langcode, data)
    if (!found) return null
    const attributes = attributesOf(found)
    const meta = (data.meta || {}) as { description?: string | null }
    return { name: (attributes.filename as string | undefined) ?? null, url: `${baseUrl}${(attributes.uri as { url?: string } | undefined)?.url || ''}`, size: Number(attributes.filesize || 0), mime: (attributes.filemime as string | undefined) ?? null, description: meta.description || null }
  }

  const link = (value: unknown) => {
    if (!value) return null
    const item = value as { uri?: string, title?: string, full_url?: string }
    const url = item.full_url || item.uri || ''
    return { title: item.title || null, url, internal: !/^[a-z]+:\/\//i.test(url) || url.startsWith(baseUrl) }
  }

  /** A resource as its Compose type: `__typename` for the unions, and every field of the mapping, lazily. */
  const entity = (resource: Resource, langcode: string): Record<string, unknown> | null => {
    const meta = typesByType.get(resource.type)
    if (!meta) return null
    const attributes = attributesOf(resource)
    const relationships = (resource.relationships || {}) as Record<string, { data?: ResourceIdentifier | ResourceIdentifier[] | null }>
    const object: Record<string, unknown> = { __typename: meta.type }
    for (const [name, field] of Object.entries(meta.fields)) {
      Object.defineProperty(object, name, { enumerable: true, get: () => fieldValue(resource, langcode, field, attributes, relationships) })
    }
    Object.defineProperty(object, 'translations', { enumerable: true, get: () => languagesOf(resource).map((code) => { const translation = internals.find(code, { type: resource.type, id: resource.id })!; return { title: labelOf(translation), langcode: languageObject(code, langcode), path: pathOf(translation, code) } }) })
    return object
  }

  const fieldValue = (resource: Resource, langcode: string, field: ComposeField, attributes: Attributes, relationships: Record<string, { data?: ResourceIdentifier | ResourceIdentifier[] | null }>): unknown => {
    const value = attributes[field.field]
    const each = <T>(convert: (item: unknown) => T): T | T[] | null => field.multiple ? (Array.isArray(value) ? value.map(convert) : []) : (value === null || value === undefined ? null : convert(value))
    switch (field.fieldType) {
      case 'uuid': return resource.id
      case 'entity_label': return labelOf(resource)
      case 'path': return pathOf(resource, langcode)
      case 'created': case 'changed': case 'timestamp': case 'datetime': return each(dateTime)
      case 'language': return languageObject(String(attributes.langcode || langcode), langcode)
      case 'boolean': return each((item) => !!item)
      case 'integer': case 'list_integer': return each((item) => Number(item))
      case 'float': case 'decimal': case 'list_float': return each((item) => Number(item))
      case 'string': case 'string_long': case 'list_string': case 'email': case 'telephone': return each((item) => String(item))
      case 'text': case 'text_long': return field.multiple ? (Array.isArray(value) ? value.map((item) => text(item, false, false)) : []) : text(value, false, field.required)
      case 'text_with_summary': return field.multiple ? (Array.isArray(value) ? value.map((item) => text(item, true, false)) : []) : text(value, true, field.required)
      case 'image': return field.multiple ? (Array.isArray(relationships[field.field]?.data) ? (relationships[field.field]!.data as ResourceIdentifier[]).map((data) => image(langcode, { data })) : []) : image(langcode, relationships[field.field])
      case 'file': return field.multiple ? (Array.isArray(relationships[field.field]?.data) ? (relationships[field.field]!.data as ResourceIdentifier[]).map((data) => file(langcode, { data })) : []) : file(langcode, relationships[field.field])
      case 'link': return each(link)
      case 'entity_reference': case 'entity_reference_revisions': case 'dynamic_entity_reference': {
        const data = relationships[field.field]?.data
        const one = (identifier: ResourceIdentifier) => { if (identifier.id === 'virtual') return null; const target = translated(langcode, identifier); return target ? entity(target, langcode) : null }
        if (field.multiple) return Array.isArray(data) ? data.map(one).filter((item) => item !== null) : []
        return data && !Array.isArray(data) ? one(data) : null
      }
      default: return null
    }
  }

  /** The entities of a bundle a visitor may read, in a language. */
  const entitiesOf = (meta: ComposeType, langcode: string): Resource[] => {
    const type = [...typesByType.entries()].find(([, candidate]) => candidate === meta)![0]
    const base = internals.stored(defaultLanguage, type).filter((resource) => readable(defaultLanguage, resource))
    return base.map((resource) => internals.find(langcode, { type, id: resource.id }) || resource)
  }

  // Compose's routes: the recorded Decoupled Router answer for the path, the breadcrumbs from the path's ancestors.
  const routeAnswer = (path: string): Record<string, unknown> | undefined => {
    const answer = internals.recorded('GET', '/router/translate-path', `path=${encodeURIComponent(path)}`)
    return answer && answer.status === 200 ? answer.body as Record<string, unknown> : undefined
  }
  const route = (path: string, langcode: string | null | undefined): Record<string, unknown> | null => {
    if (/^[a-z]+:\/\//i.test(path) && !path.startsWith(baseUrl)) return { __typename: 'RouteExternal', url: path, internal: false }
    const answer = routeAnswer(path)
    if (!answer) return null
    const { prefix } = internals.language(path)
    const resolved = String(answer.resolved || '')
    const url = resolved.replace(/^[a-z]+:\/\/[^/]+/i, '') || path
    const target = answer.entity as { type?: string, bundle?: string, uuid?: string, langcode?: string } | undefined
    const requested = langcode || internals.language(path).langcode
    const breadcrumbs = (): Array<{ title: string, url: string, internal: boolean }> => {
      if (answer.isHomePath) return []
      const home = routeAnswer(prefix || '/')
      const crumbs = [{ title: String(home?.label || 'Home'), url: prefix || '/', internal: true }]
      const segments = path.slice(prefix.length).split('/').filter(Boolean)
      for (let depth = 1; depth < segments.length; depth++) {
        const ancestor = `${prefix}/${segments.slice(0, depth).join('/')}`
        const found = routeAnswer(ancestor)
        if (found && !found.isHomePath && found.label) crumbs.push({ title: String(found.label), url: ancestor, internal: true })
      }
      return crumbs
    }
    return {
      __typename: 'RouteInternal',
      url,
      internal: true,
      get breadcrumbs() { return breadcrumbs() },
      get entity() {
        if (!target?.type || !target.bundle || !target.uuid) return null
        const resource = translated(requested, { type: `${target.type}--${target.bundle}`, id: target.uuid })
        return resource ? entity(resource, requested) : null
      },
    }
  }

  // Compose's menus: the recorded menu items, as a tree.
  const menu = (enumValue: string, langcode: string): Record<string, unknown> | null => {
    const name = menusByEnum.get(enumValue)
    if (!name) return null
    const resource = internals.stored(defaultLanguage, 'menu--menu').find((candidate) => attributesOf(candidate).drupal_internal__id === name)
    if (!resource) return null
    const recorded: Recorded | undefined = internals.recorded('GET', `${prefixOf(langcode)}/jsonapi/menu_items/${name}`) || internals.recorded('GET', `/jsonapi/menu_items/${name}`)
    const items = ((recorded?.body as { data?: Resource[] } | undefined)?.data || []).filter((item) => attributesOf(item).enabled !== false)
    // A static link's title is interface text, which the content language leaves alone: it reads as the default language's.
    const defaults: Recorded | undefined = internals.recorded('GET', `${prefixOf(defaultLanguage)}/jsonapi/menu_items/${name}`) || internals.recorded('GET', `/jsonapi/menu_items/${name}`)
    const titleOf = (item: Resource): string => {
      const attributes = attributesOf(item)
      const provider = String(attributes.provider || '')
      if (provider && provider !== 'menu_link_content' && provider !== 'views') {
        const original = ((defaults?.body as { data?: Resource[] } | undefined)?.data || []).find((candidate) => candidate.id === item.id)
        if (original) return String(attributesOf(original).title || '')
      }
      return String(attributes.title || '')
    }
    const menuLanguage = languageObject(String(attributesOf(resource).langcode || defaultLanguage), langcode)
    const children = (parent: string): unknown[] => items.filter((item) => String(attributesOf(item).parent || '') === parent).map((item) => {
      const attributes = attributesOf(item)
      const url = String(attributes.url || '')
      const classes = ((attributes.options as { attributes?: { class?: string[] | string } } | undefined)?.attributes?.class)
      return {
        id: item.id.includes(':') ? item.id.slice(item.id.indexOf(':') + 1) : item.id,
        title: titleOf(item),
        description: attributes.description == null ? null : String(attributes.description),
        url,
        langcode: menuLanguage,
        internal: !/^[a-z]+:\/\//i.test(url),
        expanded: !!attributes.expanded,
        attributes: { class: Array.isArray(classes) ? classes.join(' ') : (classes || null) },
        get children() { return children(item.id) },
        route: null,
      }
    })
    return { __typename: 'Menu', id: resource.id, name: compose.menus?.[name]?.labels?.[langcode] || labelOf(resource), get items() { return children('') } }
  }

  // Compose's connections: the edges module's cursors, sort and page rules.
  const SORT: Record<string, (resource: Resource) => string | number> = {
    CREATED_AT: (r) => Math.floor(new Date(String(attributesOf(r).created)).getTime() / 1000) || 0,
    UPDATED_AT: (r) => Math.floor(new Date(String(attributesOf(r).changed)).getTime() / 1000) || 0,
    TITLE: (r) => labelOf(r),
    STICKY: (r) => (attributesOf(r).sticky ? 1 : 0),
    PROMOTED: (r) => (attributesOf(r).promote ? 1 : 0),
    WEIGHT: (r) => Number(attributesOf(r).weight || 0),
  }
  const internalId = (resource: Resource): number => Number(attributesOf(resource)[INTERNAL_ID[entityTypeOf(resource)] || 'drupal_internal__id'])
  const cursorOf = (resource: Resource, sortKey: string | null, langcode: string | null): string => {
    const cursor: Record<string, unknown> = { backingType: entityTypeOf(resource), backingId: internalId(resource) }
    if (sortKey) cursor.sortKey = sortKey
    cursor.sortValue = sortKey ? SORT[sortKey]!(resource) : String(internalId(resource))
    cursor.filters = { published: null, langcode }
    return Buffer.from(phpJson(cursor)).toString('base64')
  }
  const connection = (meta: ComposeType, args: { first?: number | null, after?: string | null, last?: number | null, before?: string | null, reverse?: boolean | null, sortKey?: string | null, langcode?: string | null }, context: string) => {
    const limitMax = settings.edge_max_limit || 100
    const { first = null, after = null, last = null, before = null } = args
    const reverse = !!args.reverse
    const sortKey = args.sortKey || null
    if (first !== null && first > limitMax) throw new UserError(`First may not be larger than ${limitMax}.`)
    if (last !== null && last > limitMax) throw new UserError(`Last may not be larger than ${limitMax}.`)
    if (first === null && last === null) throw new UserError('You must provide one of first or last.')
    if (first !== null && last !== null) throw new UserError('Providing both first and last is not supported.')
    if (first !== null && before !== null) throw new UserError('Using first with before is not supported.')
    if (last !== null && after !== null) throw new UserError('Using last with after is not supported.')
    if (first !== null && first <= 0) throw new UserError('First must be a positive integer when provided.')
    if (last !== null && last <= 0) throw new UserError('Last must be a positive integer when provided.')
    const langcode = args.langcode || null
    const language = langcode || context
    let result: { edges: Array<{ cursor: string, node: Record<string, unknown> }>, hasNextPage: boolean, hasPreviousPage: boolean } | undefined
    const compute = () => {
      if (result) return result
      const sortValue = (resource: Resource): string | number => (sortKey ? SORT[sortKey]!(resource) : internalId(resource))
      const ascending = (first !== null && !reverse) || (last !== null && reverse)
      const compare = (a: Resource, b: Resource): number => {
        const [x, y] = [sortValue(a), sortValue(b)]
        const primary = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : Number(x) - Number(y)
        const order = primary !== 0 ? primary : internalId(a) - internalId(b)
        return ascending ? order : -order
      }
      let entities = entitiesOf(meta, language).filter((resource) => !settings.exclude_unpublished || attributesOf(resource).status === undefined || attributesOf(resource).status === true)
      const cursorText = after ?? before
      if (cursorText !== null) {
        let decoded: { backingType?: string, backingId?: number, sortKey?: string, sortValue?: unknown, filters?: Record<string, unknown> }
        try { decoded = JSON.parse(Buffer.from(cursorText, 'base64').toString('utf8')) as typeof decoded } catch { throw new Error('Invalid cursor') }
        if (!decoded || typeof decoded !== 'object') throw new Error('Invalid cursor')
        const expectedFilters = phpJson({ published: null, langcode })
        if (decoded.backingType !== entityTypeOf(entities[0] || { type: `${meta.type}--`, id: '' }) && entities.length || (decoded.sortKey ?? null) !== sortKey || phpJson(decoded.filters) !== expectedFilters) throw new UserError(`Invalid cursor ${cursorText}`)
        const after_ = (before !== null && !reverse) || (after !== null && reverse) ? -1 : 1
        const cursorSort = sortKey ? decoded.sortValue as string | number : Number(decoded.sortValue)
        const cursorId = Number(decoded.backingId)
        entities = entities.filter((resource) => {
          const value = sortValue(resource)
          const primary = typeof value === 'string' || typeof cursorSort === 'string' ? String(value).localeCompare(String(cursorSort)) : Number(value) - Number(cursorSort)
          if (primary !== 0) return after_ > 0 ? primary > 0 : primary < 0
          return after_ > 0 ? internalId(resource) > cursorId : internalId(resource) < cursorId
        })
      }
      entities.sort(compare)
      const limit = (first ?? last)!
      const page = entities.slice(0, limit + 1)
      const count = page.length
      let edges = page.slice(0, limit)
      if (last !== null) edges = edges.reverse()
      result = {
        edges: edges.map((resource) => ({ cursor: cursorOf(resource, sortKey, langcode), node: entity(resource, language)! })),
        hasNextPage: before !== null || (first !== null && first < count),
        hasPreviousPage: after !== null || (last !== null && last < count),
      }
      return result
    }
    return {
      get edges() { return compute().edges },
      get nodes() { return compute().edges.map((edge) => edge.node) },
      get pageInfo() {
        const { edges, hasNextPage, hasPreviousPage } = compute()
        return { hasNextPage, hasPreviousPage, startCursor: edges[0]?.cursor ?? null, endCursor: edges[edges.length - 1]?.cursor ?? null }
      },
    }
  }

  /** The root value: Compose's queries, each as a function of its arguments and the request's language. */
  const rootValue = (context: string): Record<string, unknown> => {
    const root: Record<string, unknown> = {
      info: () => ({ description: settings.schema_description ?? null, home: compose.front ?? null, version: settings.schema_version ?? null, languages: Object.keys(languages).map((code) => languageObject(code, context)) }),
      route: (args: { path: string, langcode?: string | null }) => route(args.path, args.langcode),
      menu: (args: { name: string, langcode?: string | null }) => menu(args.name, args.langcode || context),
    }
    const byEntityType = new Map<string, ComposeType[]>()
    for (const [resourceType, meta] of typesByType) {
      const entityType = resourceType.split('--')[0]!
      byEntityType.set(entityType, [...(byEntityType.get(entityType) || []), meta])
      if (meta.edges) root[meta.plural] = (args: Parameters<typeof connection>[1]) => connection(meta, args, context)
    }
    for (const [entityType, metas] of byEntityType) {
      const query = entityType === 'taxonomy_term' ? 'term' : entityType
      if (!metas.some((meta) => meta.queryLoad)) continue
      root[query] = (args: { id: string, langcode?: string | null }) => {
        const langcode = args.langcode || context
        for (const meta of metas) {
          if (!meta.queryLoad) continue
          const type = [...typesByType.entries()].find(([, candidate]) => candidate === meta)![0]
          const resource = translated(langcode, { type, id: args.id })
          if (resource) return entity(resource, langcode)
        }
        return null
      }
    }
    return root
  }

  const formatted = (error: GraphQLError, phase: 'graphql' | 'execute'): Record<string, unknown> => {
    const base: Record<string, unknown> = {}
    if (phase === 'graphql' || !error.originalError) {
      base.message = error.message.replace(/^(Syntax Error: .*)\.$/, '$1')
      base.extensions = { category: 'graphql' }
    } else if (error.originalError instanceof UserError) {
      base.message = error.message
      base.extensions = { category: 'user' }
    } else {
      base.message = 'Internal server error'
      base.extensions = { category: 'internal' }
    }
    if (error.locations) base.locations = error.locations.map((location) => ({ line: location.line, column: location.column }))
    if (error.path) base.path = error.path
    return base
  }

  const handle = (method: string, url: string, requestHeaders: Record<string, string> = {}, requestBody?: string): Answer | undefined => {
    const parsed = new URL(url, baseUrl)
    const { langcode, rest } = internals.language(parsed.pathname)
    if (rest !== endpoint) return undefined
    const headers = { 'content-type': 'application/json' }
    const resolved = internals.session(requestHeaders)
    if ('invalid' in resolved) return { status: 401, headers: { 'content-type': 'text/html; charset=UTF-8', 'www-authenticate': `Bearer realm="OAuth", error="access_denied", error_description="${resolved.invalid}"` }, body: '<!DOCTYPE html><html><body><h1>Unauthorized</h1></body></html>' }
    const permission = `execute ${compose.server || 'graphql_compose_server'} arbitrary graphql requests`
    if (!internals.permissions(resolved).has(permission)) return { status: 403, headers, body: { message: `The '${permission}' permission is required.` } }
    let request: { query?: string, variables?: Record<string, unknown> | string | null, operationName?: string | null }
    if (method.toUpperCase() === 'GET') {
      request = { query: parsed.searchParams.get('query') || '', variables: parsed.searchParams.get('variables'), operationName: parsed.searchParams.get('operationName') }
    } else {
      try { request = JSON.parse(requestBody || '{}') as typeof request } catch { return { status: 400, headers, body: { errors: [{ message: 'GraphQL Request must include at least one of those two parameters: "query" or "queryId"', extensions: { category: 'request' } }] } } }
    }
    const variables = typeof request.variables === 'string' ? (JSON.parse(request.variables || '{}') as Record<string, unknown>) : (request.variables || {})
    let document
    try {
      document = parse(request.query || '')
    } catch (error) {
      return { status: 200, headers, body: { errors: [formatted(error as GraphQLError, 'graphql')] } }
    }
    const problems = validate(schema, document)
    if (problems.length) return { status: 200, headers, body: { errors: problems.map((problem) => formatted(problem, 'graphql')) } }
    const result = executeSync({ schema, document, rootValue: rootValue(langcode), variableValues: variables, operationName: request.operationName || undefined })
    // Drupal leaves `data` out when a non-null root field failed and took the whole of it down.
    const body: Record<string, unknown> = {}
    if (result.errors?.length) body.errors = result.errors.map((error) => formatted(error, 'execute'))
    if (result.data !== null && result.data !== undefined) body.data = result.data
    return { status: 200, headers, body }
  }

  return { handle, schema }
}
