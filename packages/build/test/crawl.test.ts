import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { crawl, passwordGrantInstalled } from '../src/crawl'

type Answer = { status?: number, body: unknown }

/** A Drupal small enough to read: a map of `path?query` to its answer, by whether the request carries a token. */
const drupal = (routes: (path: string, admin: boolean) => Answer | undefined): Promise<{ server: Server, base: string }> => new Promise((resolve) => {
  const server = createServer((request, response) => {
    const admin = !!request.headers.authorization
    const answer = request.url === '/oauth/token' ? { body: { access_token: 't' } } : routes(request.url || '/', admin)
    response.writeHead(answer?.status ?? (answer ? 200 : 404), { 'content-type': 'application/vnd.api+json' })
    response.end(JSON.stringify(answer?.body ?? {}))
  })
  server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }))
})

const servers: Server[] = []
afterEach(() => { for (const server of servers.splice(0)) server.close() })

const LIMIT = '?page%5Blimit%5D=50'
const user = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ type: 'user--user', id, attributes: { name, ...extra } })
const read = (out: string, file: string): unknown => JSON.parse((file.endsWith('.gz') ? gunzipSync(readFileSync(join(out, file))) : readFileSync(join(out, file))).toString('utf8'))

const build = async (routes: Parameters<typeof drupal>[0], options: Partial<Parameters<typeof crawl>[0]> = {}, out = mkdtempSync(join(tmpdir(), 'crawl-'))) => {
  const { server, base } = await drupal(routes)
  servers.push(server)
  const manifest = await crawl({ baseUrl: base, out, preset: 't', languages: { en: '' }, defaultLanguage: 'en', drupal: { core: '11', profile: 'x', modules: {} }, auth: { tokenUrl: `${base}/oauth/token`, clientId: 'c', clientSecret: 's' }, log: () => undefined, ...options })
  return { manifest, out, base }
}

const site = (users: { admin: unknown[], visitor: unknown[] }, more: Parameters<typeof drupal>[0] = () => undefined) => (path: string, admin: boolean): Answer | undefined => {
  if (path === '/jsonapi') return { body: { links: { self: { href: 'x' }, 'user--user': { href: 'http://elsewhere.test/jsonapi/user/user' } } } }
  if (path === `/jsonapi/user/user${LIMIT}`) return { body: { data: admin ? users.admin : users.visitor, links: {} } }
  return more(path, admin)
}

describe('the crawl', () => {
  it('follows an index link on another host, and records what a visitor may read by id and not by count', async () => {
    const { out } = await build(site({ admin: [user('a', 'a'), user('b', 'b')], visitor: [user('a', 'a'), user('c', 'c')] }))
    expect(read(out, 'resources/en/user--user.json.gz')).toHaveLength(2)
    expect((read(out, 'access/en.json.gz') as Record<string, { visible: string[] }>)['user--user']!.visible).toEqual(['a', 'c'])
  })

  it('reads a field as hidden when only an excluded resource shows it to the visitor', async () => {
    const { out } = await build(site({ admin: [user('a', 'a', { mail: 'm' }), user('x', 'x', { mail: 'n' })], visitor: [user('a', 'a'), user('x', 'x', { mail: 'n' })] }), { exclude: (resource) => resource.id === 'x' })
    expect((read(out, 'access/en.json.gz') as Record<string, { hidden: string[] }>)['user--user']!.hidden).toEqual(['mail'])
  })

  it('fails the build when a later page cannot be read, and leaves a refused type out', async () => {
    await expect(build((path) => {
      if (path === '/jsonapi') return { body: { links: { 'node--a': { href: '/jsonapi/node/a' } } } }
      if (path === `/jsonapi/node/a${LIMIT}`) return { body: { data: [], links: { next: { href: '/jsonapi/node/a?page=2' } } } }
      return path === '/jsonapi/node/a?page=2' ? { status: 500, body: {} } : undefined
    })).rejects.toThrow(/answered 500/)
    const { out } = await build((path) => {
      if (path === '/jsonapi') return { body: { links: { 'node--a': { href: '/jsonapi/node/a' } } } }
      return path === `/jsonapi/node/a${LIMIT}` ? { status: 403, body: {} } : undefined
    })
    expect(existsSync(join(out, 'resources/en/node--a.json.gz'))).toBe(false)
  })

  it('scrubs an excluded user from a recorded relationship', async () => {
    const { out: scrubbed } = await build((path) => {
      if (path === '/jsonapi') return { body: { links: { 'user--user': { href: '/jsonapi/user/user' } } } }
      if (path === `/jsonapi/user/user${LIMIT}`) return { body: { data: [user('x', 'x')], links: {} } }
      if (path.startsWith('/jsonapi/decoupled/settings')) return { body: { data: [{ type: 'node--a', id: 'n', relationships: { uid: { data: { type: 'user--user', id: 'x' } }, tags: { data: [{ type: 'user--user', id: 'x' }] } } }] } }
      return undefined
    }, { exclude: (resource) => resource.id === 'x' })
    const routes = read(scrubbed, 'recorded/routes.json.gz') as Record<string, { body: { data: Array<{ relationships: Record<string, { data: unknown }> }> } }>
    const relationships = routes['GET /jsonapi/decoupled/settings']!.body.data[0]!.relationships
    expect(relationships.uid!.data).toBeNull()
    expect(relationships.tags!.data).toEqual([])
  })

  it('records a session token as <token>, though its answer is the bare token', async () => {
    const oracleOut = mkdtempSync(join(tmpdir(), 'oracle-'))
    await build(site({ admin: [], visitor: [] }, (path) => (path === '/session/token' ? { body: 'a-real-csrf-token' } : undefined)), { oracleOut, writes: [{ name: 'csrf', as: 'anonymous', steps: [{ method: 'GET', path: '/session/token' }] }] })
    const recorded = read(oracleOut, 'writes.json.gz') as Array<{ answers: Array<{ body: unknown }> }>
    expect(recorded[0]!.answers[0]!.body).toBe('<token>')
    expect(JSON.stringify(recorded)).not.toContain('a-real-csrf-token')
  })

  it('keeps a boundary on the origin in what it writes', async () => {
    const out = mkdtempSync(join(tmpdir(), 'crawl-'))
    let own = ''
    const { server, base } = await drupal((path) => (path === '/jsonapi' ? { body: { links: {}, note: `${own}.evil/a ${own}:9/b ${own}/c` } } : undefined))
    servers.push(server)
    own = base
    await crawl({ baseUrl: base, out, preset: 't', languages: { en: '' }, defaultLanguage: 'en', drupal: { core: '11', profile: 'x', modules: {} }, log: () => undefined })
    expect((read(out, 'index/en.json') as { note: string }).note).toBe(`${base}.evil/a ${base}:9/b https://drupal.invalid/c`)
  })

  it('records a refusal by its path only when the plain path is refused too', async () => {
    const { out } = await build(site({ admin: [user('a', 'a')], visitor: [user('a', 'a')] }, (path) => {
      if (path === '/jsonapi/user/user?filter=1') return { status: 403, body: {} }
      if (path === '/jsonapi/user/user') return { body: { data: [] } }
      return undefined
    }), { oracle: ['/jsonapi/user/user?filter=1'] })
    expect(read(out, 'recorded/routes.json.gz')).not.toHaveProperty(['GET /jsonapi/user/user'])
  })

  it('records a term\'s system path, and leaves nothing of an earlier build behind', async () => {
    const out = mkdtempSync(join(tmpdir(), 'crawl-'))
    mkdirSync(join(out, 'oracle'), { recursive: true })
    writeFileSync(join(out, 'oracle/queries.json.gz'), 'old')
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ files: { 'oracle/queries.json.gz': 'x' } }))
    await build((path) => {
      if (path === '/jsonapi') return { body: { links: { 'taxonomy_term--t': { href: '/jsonapi/taxonomy_term/t' } } } }
      if (path === `/jsonapi/taxonomy_term/t${LIMIT}`) return { body: { data: [{ type: 'taxonomy_term--t', id: 't', attributes: { drupal_internal__tid: 7 } }], links: {} } }
      return undefined
    }, {}, out)
    expect(existsSync(join(out, 'oracle/queries.json.gz'))).toBe(false)
    expect(read(out, 'recorded/routes.json.gz')).toHaveProperty(['GET /router/translate-path?path=%2Ftaxonomy%2Fterm%2F7'])
  })
})

describe('a site that gets in the way', () => {
  it('stops on an index that is not JSON:API, rather than building nothing', async () => {
    await expect(build((path) => (path === '/jsonapi' ? { body: '<html>Install</html>' } : undefined))).rejects.toThrow('not a JSON:API index')
  })

  it('reads a type by id when the site cannot take an offset, past a page that exposes no machine name', async () => {
    const view = (id: string) => ({ type: 'view--view', id, attributes: { label: id } })
    const refused = { status: 500, body: { errors: [{ detail: 'array_slice(): Argument #2 ($offset) must be of type int, string given' }] } }
    const routes = (path: string) => {
      if (path === '/jsonapi') return { body: { links: { self: { href: 'x' }, 'view--view': { href: 'http://x.test/jsonapi/view/view' } } } }
      if (path === `/jsonapi/view/view${LIMIT}`) return { body: { data: [view('a'), view('b')], links: { next: { href: 'http://x.test/jsonapi/view/view?page%5Boffset%5D=2&page%5Blimit%5D=50' } } } }
      if (path.includes('page%5Boffset%5D')) return refused
      if (path.startsWith('/jsonapi/view/view?sort=id')) {
        if (!path.includes('filter')) return { body: { data: [view('a'), view('b')], links: {} } }
        return { body: { data: path.endsWith('%5D=b') ? [view('c')] : [], links: {} } }
      }
      return undefined
    }
    const { out } = await build(routes)
    expect((read(out, 'resources/en/view--view.json.gz') as Array<{ id: string }>).map((resource) => resource.id)).toEqual(['a', 'b', 'c'])
  })

  it('says so when it reads none of a type and cannot go past the first page', async () => {
    const lines: string[] = []
    const routes = (path: string) => {
      if (path === '/jsonapi') return { body: { links: { self: { href: 'x' }, 'view--view': { href: 'http://x.test/jsonapi/view/view' } } } }
      if (path === `/jsonapi/view/view${LIMIT}`) return { body: { data: [], links: { next: { href: 'http://x.test/jsonapi/view/view?page%5Boffset%5D=50&page%5Blimit%5D=50' } } } }
      if (path.includes('page%5Boffset%5D')) return { status: 500, body: { errors: [{ detail: 'array_slice(): Argument #2 ($offset) must be of type int, string given' }] } }
      return undefined
    }
    await build(routes, { log: (line) => lines.push(line) })
    expect(lines).toContain('  view--view: nothing readable, and a second page the site cannot serve, left out')
  })

  it('leaves no recording of an earlier build behind', async () => {
    const out = mkdtempSync(join(tmpdir(), 'crawl-'))
    const oracleOut = `${out}.oracle`
    mkdirSync(oracleOut, { recursive: true })
    writeFileSync(join(oracleOut, 'reads.json.gz'), 'old')
    writeFileSync(join(oracleOut, 'writes.json.gz'), 'old')
    const { manifest } = await build((path) => (path === '/jsonapi' ? { body: { links: {} } } : undefined), {}, out)
    expect(existsSync(join(oracleOut, 'reads.json.gz'))).toBe(false)
    expect(existsSync(join(oracleOut, 'writes.json.gz'))).toBe(false)
    expect(manifest.oracle).toBeUndefined()
  })

  it('leaves out a type it is told to', async () => {
    const { out } = await build(site({ admin: [], visitor: [] }), { skipTypes: ['user--user'] })
    expect(existsSync(join(out, 'resources/en/user--user.json.gz'))).toBe(false)
  })
})


describe('the password grant probe', () => {
  it('reads an answer the grant gave as installed, and the refusal of a missing grant as not', () => {
    expect(passwordGrantInstalled(200, '{"access_token":"t"}')).toBe(true)
    expect(passwordGrantInstalled(400, '{"error":"invalid_grant"}')).toBe(true)
    expect(passwordGrantInstalled(400, '{"error":"unsupported_grant_type","hint":"Grant type is not installed."}')).toBe(false)
  })

  it('stops the build on an answer that says neither', () => {
    expect(() => passwordGrantInstalled(401, '{"error":"invalid_client"}')).toThrow('The password grant probe got 401')
    expect(() => passwordGrantInstalled(500, '<html>')).toThrow('The password grant probe got 500')
  })
})
