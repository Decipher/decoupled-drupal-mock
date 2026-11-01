import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Document, Manifest, Recorded, Resource } from 'decoupled-drupal-mock'
import { sortedSearch } from 'decoupled-drupal-mock'

export interface CrawlOptions {
  /** The Drupal to crawl, such as `http://127.0.0.1:8888`. */
  baseUrl: string
  /** Where the build is written. */
  out: string
  preset: string
  /** Langcode to URL prefix, `''` for the default language. */
  languages: Record<string, string>
  defaultLanguage: string
  drupal: Manifest['drupal']
  /** The origin written into the dump in place of the crawled one. */
  origin?: string
  /** The oracle query list: request paths with their query strings, recorded with Drupal's answers. */
  oracle?: string[]
  /**
   * Credentials that read everything, for the dump: a Simple OAuth client with the client credentials grant and a
   * scope that gives an administrator's roles. The anonymous crawl beside it records what a visitor may read.
   */
  auth?: { tokenUrl: string, clientId: string, clientSecret: string, scope?: string }
  /** Resources the dump leaves out, such as the build's own user: a function of each resource. */
  exclude?: (resource: Resource) => boolean
  /**
   * Reads a resource no user may read through JSON:API, such as a block whose visibility denies every request, so
   * the dump can place it in a collection and report it omitted as Drupal does. The CLI reads it through drush.
   */
  phantomData?: (entityType: string, uuid: string) => Promise<Record<string, unknown> | undefined>
  log?: (line: string) => void
}

const PLACEHOLDER = 'https://drupal.invalid'

/** The resource types the crawl leaves out: they hold secrets or vary per install. */
const SKIP = new Set(['consumer--consumer', 'oauth2_scope--oauth2_scope', 'oauth2_token_type--oauth2_token_type', 'user_role--user_role', 'action--action'])

export const crawl = async (options: CrawlOptions): Promise<Manifest> => {
  const base = options.baseUrl.replace(/\/+$/, '')
  const origin = (options.origin || PLACEHOLDER).replace(/\/+$/, '')
  const log = options.log || ((line: string) => console.log(line))
  // Only the origin itself: a host that merely begins with it is another site's.
  const crawled = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.:-])`, 'g')
  const relink = (text: string): string => text.replace(crawled, origin)
  /** A link as a path on the crawled site, whatever host the site wrote it with. */
  const basePath = new URL(base).pathname.replace(/\/+$/, '')
  const pathOf = (href: string): string => {
    const url = new URL(href, `${base}/`)
    return `${basePath && url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname}${url.search}`
  }
  const files: Record<string, string> = {}

  // What an earlier build into this directory wrote and this one might not: the manifest refuses a file it does not list.
  const previous = join(options.out, 'manifest.json')
  if (existsSync(previous)) {
    for (const file of Object.keys((JSON.parse(readFileSync(previous, 'utf8')) as Manifest).files)) rmSync(join(options.out, file), { force: true })
  }

  const write = (file: string, body: unknown): void => {
    const path = join(options.out, file)
    mkdirSync(join(path, '..'), { recursive: true })
    const text = relink(JSON.stringify(body))
    const bytes = file.endsWith('.gz') ? gzipSync(Buffer.from(text), { level: 9 }) : Buffer.from(text)
    writeFileSync(path, bytes)
    files[file] = createHash('sha256').update(bytes).digest('hex')
  }

  let token: string | undefined
  if (options.auth) {
    const response = await fetch(options.auth.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: options.auth.clientId, client_secret: options.auth.clientSecret, ...(options.auth.scope ? { scope: options.auth.scope } : {}) }) })
    const granted = await response.json() as { access_token?: string, error?: string, error_description?: string }
    if (!granted.access_token) throw new Error(`The token request failed: ${granted.error_description || granted.error || response.status}.`)
    token = granted.access_token
  }
  const authorized = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

  const get = async (path: string, headers: Record<string, string> = {}): Promise<{ status: number, headers: Record<string, string>, body: unknown }> => {
    const url = path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
    const response = await fetch(url, { headers: { accept: 'application/vnd.api+json, application/json;q=0.9, */*;q=0.8', ...headers } }).catch((err: unknown) => { throw new Error(`GET ${url}: ${(err as Error).message}`) })
    const text = await response.text()
    const type = response.headers.get('content-type') || ''
    const body: unknown = type.includes('json') ? JSON.parse(text) : text
    return { status: response.status, headers: { 'content-type': type.split(';')[0]!.trim() }, body }
  }

  const recorded: Record<string, Recorded> = {}
  /** The ids of what the crawl excluded, so a recorded document listing one by id alone drops it too. */
  const excludedIds = new Set<string>()
  const excluded = (resource: Resource): boolean => excludedIds.has(`${resource.type}:${resource.id}`) || !!options.exclude?.(resource)
  /** A recorded JSON:API document without the excluded resources, such as the build's own user in a "who's new" view. */
  const scrub = (entry: Recorded): Recorded => {
    const body = entry.body as { data?: Resource[], included?: Resource[], meta?: { count?: number } } | null
    if (!options.exclude || !body || typeof body !== 'object' || !Array.isArray(body.data)) return entry
    // A kept resource names no excluded one in its relationships either.
    const gone = (identifier: { type: string, id: string }): boolean => excludedIds.has(`${identifier.type}:${identifier.id}`)
    const unlinked = (resource: Resource): Resource => {
      if (!resource.relationships) return resource
      const relationships = Object.fromEntries(Object.entries(resource.relationships).map(([name, relationship]) => {
        const { data } = relationship
        if (Array.isArray(data)) return [name, { ...relationship, data: data.filter((identifier) => !gone(identifier)) }]
        return [name, data && gone(data) ? { ...relationship, data: null } : relationship]
      }))
      return { ...resource, relationships }
    }
    const kept = body.data.filter((resource) => !excluded(resource)).map(unlinked)
    const meta = body.meta && typeof body.meta.count === 'number' ? { ...body.meta, count: body.meta.count - (body.data.length - kept.length) } : body.meta
    return { ...entry, body: { ...body, data: kept, ...(body.included ? { included: body.included.filter((resource) => !excluded(resource)).map(unlinked) } : {}), ...(meta ? { meta } : {}) } }
  }
  const record = async (path: string): Promise<Recorded> => {
    const [pathname, search = ''] = path.split('?') as [string, string?]
    const key = `GET ${pathname}${search ? `?${sortedSearch(search)}` : ''}`
    const entry = scrub(await get(path))
    recorded[key] = entry
    return entry
  }

  const all: Record<string, Record<string, Resource[]>> = {}
  for (const [langcode, prefix] of Object.entries(options.languages)) {
    const lang = prefix ? `/${prefix}` : ''
    log(`${langcode}: the index`)
    const index = await get(`${lang}/jsonapi`)
    if (index.status !== 200) throw new Error(`${lang}/jsonapi answered ${index.status}.`)
    write(`index/${langcode}.json`, index.body)
    const links = ((index.body as Document).links || {}) as Record<string, { href: string } | null>
    all[langcode] = {}
    const access: Record<string, { visible?: string[], hidden?: string[], forbidden?: true, phantom?: string[] }> = {}
    /** What Drupal reported as omitted on the administrator's crawl: resources no user reads. */
    const phantom: Record<string, string[]> = {}
    /** The attribute and relationship names a set of resources carries. */
    const fieldNames = (resources: Resource[]): Set<string> => new Set(resources.flatMap((resource) => [...Object.keys(resource.attributes || {}), ...Object.keys(resource.relationships || {})]))
    /** Every resource of a type, page by page, as the given user reads it. */
    const collect = async (href: string, headers: Record<string, string>): Promise<Resource[] | number> => {
      const resources: Resource[] = []
      let next: string | undefined = `${pathOf(href)}?page%5Blimit%5D=50`
      let first = true
      while (next) {
        let page = await get(next, headers)
        // A server's failure is tried again; one that stays, or a later page refused, would leave a type half read.
        for (let attempt = 0; attempt < 2 && page.status >= 500; attempt++) page = await get(next, headers)
        if (page.status >= 500 || (!first && page.status !== 200)) throw new Error(`GET ${next} answered ${page.status}: the build would hold part of ${href}.`)
        if (page.status !== 200) return page.status
        first = false
        const document = page.body as Document
        resources.push(...(document.data as Resource[]))
        if (headers.authorization) {
          const left = (document.meta?.omitted as { links?: Record<string, { href: string }> } | undefined)?.links || {}
          for (const [key, item] of Object.entries(left)) if (key !== 'help' && item?.href) (phantom[href] = phantom[href] || []).push(item.href.split('/').pop()!)
        }
        const link = document.links?.next
        next = link ? pathOf(link.href) : undefined
      }
      return resources
    }
    for (const [type, link] of Object.entries(links)) {
      if (type === 'self' || !link || SKIP.has(type)) continue
      const collected = await collect(link.href, authorized())
      if (typeof collected === 'number') {
        log(`  ${type}: ${collected}, left out`)
        continue
      }
      const full = options.exclude ? collected.filter((resource) => !options.exclude!(resource)) : collected
      for (const resource of collected) if (!full.includes(resource)) excludedIds.add(`${resource.type}:${resource.id}`)
      if (token) {
        // What a visitor may read of it.
        const anonymous = await collect(link.href, {})
        if (typeof anonymous === 'number') access[type] = { forbidden: true }
        else {
          const entry: { visible?: string[], hidden?: string[] } = {}
          const seenByVisitor = anonymous.filter((resource) => !excluded(resource))
          const ids = new Set(seenByVisitor.map((resource) => resource.id))
          if (full.some((resource) => !ids.has(resource.id))) entry.visible = [...ids]
          // A field the administrator reads and the visitor does not, such as revision_log.
          const seen = fieldNames(seenByVisitor)
          const hidden = [...fieldNames(full)].filter((name) => !seen.has(name))
          if (hidden.length && seenByVisitor.length) entry.hidden = hidden
          if (Object.keys(entry).length) access[type] = entry
        }
        const ids = [...new Set(phantom[link.href] || [])]
        if (ids.length) {
          access[type] = { ...access[type], phantom: ids }
          // With its data in the dump, a phantom filters and sorts as Drupal's does, and is never served.
          for (const id of ids) {
            const attributes = await options.phantomData?.(type.split('--')[0]!, id)
            if (attributes) full.push({ type, id, attributes })
            else log(`  ${type}: ${id} is omitted for every user and has no data; it matches only an unfiltered query`)
          }
        }
      }
      if (full.length) {
        all[langcode]![type] = full
        write(`resources/${langcode}/${type}.json.gz`, full)
      }
    }
    if (Object.keys(access).length) write(`access/${langcode}.json.gz`, access)
    log(`${langcode}: ${Object.keys(all[langcode]!).length} types, ${Object.values(all[langcode]!).reduce((n, list) => n + list.length, 0)} resources, ${Object.keys(access).length} types with limited access`)

    // The default language also answers unprefixed, with the same index.
    if (langcode === options.defaultLanguage && lang) await record('/jsonapi')

    // Decoupled Router, for every resource's alias in this language, every node's and term's system path, and the front page.
    const aliases = Object.values(all[langcode]!).flat().map((resource) => (resource.attributes as { path?: { alias?: string | null } }).path?.alias).filter((alias): alias is string => !!alias)
    const nodes = Object.entries(all[langcode]!).filter(([type]) => type.startsWith('node--')).flatMap(([, list]) => list.map((node) => `/node/${String((node.attributes as { drupal_internal__nid?: number }).drupal_internal__nid)}`))
    const terms = Object.entries(all[langcode]!).filter(([type]) => type.startsWith('taxonomy_term--')).flatMap(([, list]) => list.map((term) => `/taxonomy/term/${String((term.attributes as { drupal_internal__tid?: number }).drupal_internal__tid)}`))
    const systemPaths = [...nodes, ...terms]
    const prefixed = [lang || '/', `${lang}/node`, ...aliases.map((alias) => `${lang}${alias}`), ...systemPaths.map((path) => `${lang}${path}`)]
    // The default language answers unprefixed too, as a client asks for `/` or `/node/1`.
    const unprefixed = langcode === options.defaultLanguage && lang ? ['/', '/node', ...aliases, ...systemPaths] : []
    const paths = [...new Set([...prefixed, ...unprefixed])]
    log(`${langcode}: ${paths.length} router lookups`)
    for (const path of paths) await record(`/router/translate-path?path=${encodeURIComponent(path)}`)

    // Menus, as JSON:API Menu Items and as linksets.
    for (const menu of all[langcode]!['menu--menu'] || []) {
      const id = String((menu.attributes as { drupal_internal__id?: string }).drupal_internal__id)
      await record(`${lang}/jsonapi/menu_items/${id}`)
      await record(`${lang}/system/menu/${id}/linkset`)
    }

    // Views, every display of every view, through JSON:API Views.
    for (const view of all[langcode]!['view--view'] || []) {
      const attributes = view.attributes as { drupal_internal__id?: string, display?: Record<string, unknown> }
      for (const display of Object.keys(attributes.display || {})) {
        const entry = await record(`${lang}/jsonapi/views/${attributes.drupal_internal__id}/${display}`)
        if (entry.status !== 200) delete recorded[`GET ${lang}/jsonapi/views/${attributes.drupal_internal__id}/${display}`]
      }
    }

    await record(`${lang}/jsonapi/decoupled/settings`)
  }
  // The oracle: real queries with Drupal's real answers, for the engine's tests.
  if (options.oracle?.length) {
    const entries: Array<{ request: string, status: number, headers: Record<string, string>, body: unknown }> = []
    // `{type:n}` is the nth resource of that type in the default language's dump.
    const resolve = (request: string): string => request.replace(/\{([a-z0-9_]+--[a-z0-9_]+):(\d+)\}/g, (_whole, type: string, n: string) => all[options.defaultLanguage]?.[type]?.[Number(n)]?.id || `missing-${type}-${n}`)
    for (const request of options.oracle) {
      const resolved = resolve(request)
      const entry = await get(resolved)
      entries.push({ request: resolved, ...entry })
      // A type that refuses reads is recorded by its path, so the engine refuses it as Drupal does. A query refused
      // for what it asks, such as a filter on a field, says nothing of the plain path, so that is asked too.
      if (entry.status === 403 || entry.status === 405) {
        const [pathname, search] = resolved.split('?') as [string, string?]
        const plain = search ? await get(pathname) : entry
        if (plain.status === 403 || plain.status === 405) recorded[`GET ${pathname}`] = recorded[`GET ${pathname}`] || plain
      }
    }
    write('oracle/queries.json.gz', entries)
    log(`${entries.length} oracle entries`)
  }
  write('recorded/routes.json.gz', recorded)

  const manifest: Manifest = {
    preset: options.preset,
    drupal: options.drupal,
    built: new Date().toISOString(),
    origin,
    languages: options.languages,
    defaultLanguage: options.defaultLanguage,
    files,
  }
  writeFileSync(join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
