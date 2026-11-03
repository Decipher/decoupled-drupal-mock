import { describe, expect, it, vi } from 'vitest'
import { createMock } from '../src'
import type { Extension } from '../src'
import { connectMock } from '../src/control'
import { listen } from '../src/serve'
import { dump } from './dump'

const BASE = 'https://drupal.test'
const json = async (response: Response) => await response.json() as { data?: { id?: string, attributes?: Record<string, unknown> } | unknown[], ok?: boolean, seen?: unknown, id?: string, count?: number }

describe('an extension', () => {
  it('adds a route, with its params, its JSON body and any language prefix', async () => {
    const route: Extension = { routes: { 'POST /api/:id/preview': ({ params, json: body, prefix }) => ({ body: { id: params.id, seen: body, ok: prefix === undefined } }) } }
    const mock = createMock(dump, { baseUrl: BASE, extensions: [route] })
    const answer = await mock.fetch(`${BASE}/api/n-1/preview`, { method: 'POST', body: '{"a":1}' })
    expect(answer.headers.get('content-type')).toBe('application/json')
    expect(await json(answer)).toEqual({ id: 'n-1', seen: { a: 1 }, ok: true })
    expect((await mock.fetch(`${BASE}/api/n-1/preview`)).status).not.toBe(200)
  })

  it('leaves the stock site alone', async () => {
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ routes: { 'GET /other': () => ({ body: {} }) } }] })
    expect(((await json(await mock.fetch(`${BASE}/jsonapi/node/page/p-1`))).data as { id: string }).id).toBe('p-1')
  })

  it('overrides or fails a stock answer through `answer`, and passes the rest on', async () => {
    const answer: Extension = {
      answer: ({ query }, next) => {
        if (query.fail) return { status: 503, body: 'down' }
        const stock = next()
        return query.resourceVersion ? { ...stock, body: { ...(stock.body as object), seen: query.resourceVersion } } : stock
      },
    }
    const mock = createMock(dump, { baseUrl: BASE, extensions: [answer] })
    expect((await mock.fetch(`${BASE}/jsonapi/node/page/p-1?fail=1`)).status).toBe(503)
    expect((await json(await mock.fetch(`${BASE}/jsonapi/node/page/p-1?resourceVersion=rel:latest-version`))).seen).toBe('rel:latest-version')
    expect((await mock.fetch(`${BASE}/jsonapi/node/page/p-1`)).status).toBe(200)
  })

  it('adds fixtures that read like the dump\'s own, without touching the dump', async () => {
    const extra = { type: 'node--page', id: 'p-extra', attributes: { title: 'Extra' }, relationships: {} }
    const before = dump.resources.en!['node--page']!.length
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ fixtures: { en: { 'node--page': [extra] } } }] })
    expect((await mock.fetch(`${BASE}/jsonapi/node/page/p-extra`)).status).toBe(200)
    expect(dump.resources.en!['node--page']).toHaveLength(before)
  })

  it('keeps state across requests until a reset', async () => {
    const counter: Extension = { routes: { 'POST /count': ({ state }) => {
      const count = ((state.get('count') as number | undefined) || 0) + 1
      state.set('count', count)
      return { body: { count } }
    } } }
    const mock = createMock(dump, { baseUrl: BASE, extensions: [counter] })
    await mock.fetch(`${BASE}/count`, { method: 'POST' })
    expect((await json(await mock.fetch(`${BASE}/count`, { method: 'POST' }))).count).toBe(2)
    mock.reset()
    expect((await json(await mock.fetch(`${BASE}/count`, { method: 'POST' }))).count).toBe(1)
  })

  it('refuses a handler that is not synchronous, with its name', () => {
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ name: 'slow', routes: { 'GET /slow': (() => Promise.resolve({})) as never } }] })
    expect(() => mock.handle('GET', `${BASE}/slow`)).toThrow('The extension slow must answer synchronously')
  })

  it('refuses a route that names no path', () => {
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ routes: { '/no-method': () => ({}) } }] })
    expect(() => mock.handle('GET', `${BASE}/x`)).toThrow('is not "METHOD /path"')
  })
})

describe('what a test does to the mock', () => {
  it('adds an extension for one test, newest first, and a reset drops it', async () => {
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ routes: { 'GET /who': () => ({ body: { id: 'base' } }) } }] })
    mock.use({ routes: { 'GET /who': () => ({ body: { id: 'test' } }) } })
    expect((await json(await mock.fetch(`${BASE}/who`))).id).toBe('test')
    mock.reset()
    expect((await json(await mock.fetch(`${BASE}/who`))).id).toBe('base')
  })

  it('turns a named scenario on until a reset, and refuses a name nothing has', async () => {
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ scenarios: { down: { answer: () => ({ status: 503, body: 'down' }) } } }] })
    expect(() => mock.scenario('nope')).toThrow('No extension names a scenario "nope"')
    mock.scenario('down')
    expect((await mock.fetch(`${BASE}/jsonapi`)).status).toBe(503)
    mock.reset()
    expect((await mock.fetch(`${BASE}/jsonapi`)).status).toBe(200)
  })

  it('records what it was asked and how it answered', async () => {
    const mock = createMock(dump, { baseUrl: BASE })
    await mock.fetch(`${BASE}/jsonapi/node/page?page[limit]=1`, { headers: { authorization: 'Bearer nope' } })
    const [request] = mock.requests()
    expect(request).toMatchObject({ method: 'GET', path: '/jsonapi/node/page', status: 401, headers: { authorization: 'Bearer nope' } })
    mock.reset()
    expect(mock.requests()).toEqual([])
  })

  it('moves a token past its expiry, and a reset puts the clock back', async () => {
    const mock = createMock(dump, { baseUrl: BASE })
    const headers = { authorization: `Bearer ${mock.tokenFor('umami').access}` }
    expect((await mock.fetch(`${BASE}/jsonapi/node/page`, { headers })).status).toBe(200)
    mock.advanceTime(3600)
    expect((await mock.fetch(`${BASE}/jsonapi/node/page`, { headers })).status).toBe(401)
    mock.reset()
    const fresh = { authorization: `Bearer ${mock.tokenFor('umami').access}` }
    expect((await mock.fetch(`${BASE}/jsonapi/node/page`, { headers: fresh })).status).toBe(200)
  })

  it('calls out on a successful write and not on a refused one, and the write does not wait', async () => {
    const call = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    try {
      const onWrite = vi.fn(({ send, resource }: Parameters<NonNullable<Extension['onWrite']>>[0]) => send(`http://site.test/revalidate?id=${resource?.id}`))
      const mock = createMock(dump, { baseUrl: BASE, extensions: [{ onWrite }] })
      const body = JSON.stringify({ data: { type: 'node--recipe', id: 'r-1', attributes: { title: 'Changed' } } })
      const content = { 'content-type': 'application/vnd.api+json' }
      expect(mock.handle('PATCH', `${BASE}/jsonapi/node/recipe/r-1`, content, body).status).toBeGreaterThanOrEqual(400)
      expect(onWrite).not.toHaveBeenCalled()
      const headers = { ...content, authorization: `Bearer ${mock.tokenFor('umami', ['editor']).access}` }
      expect(mock.handle('PATCH', `${BASE}/jsonapi/node/recipe/r-1`, headers, body).status).toBe(200)
      expect(onWrite).toHaveBeenCalledTimes(1)
      expect(call).toHaveBeenCalledWith('http://site.test/revalidate?id=r-1', {})
      await vi.waitFor(() => expect(mock.sent()).toEqual([{ url: 'http://site.test/revalidate?id=r-1', method: 'GET', status: 200 }]))
    } finally {
      call.mockRestore()
    }
  })

  it('hears only of writes the stock site took, under its own base path, and keeps a write whose call-back threw', () => {
    const body = JSON.stringify({ data: { type: 'node--recipe', id: 'r-1', attributes: { title: 'Changed' } } })
    const content = { 'content-type': 'application/vnd.api+json' }
    const onWrite = vi.fn()
    const own = createMock(dump, { baseUrl: BASE, extensions: [{ onWrite, routes: { 'POST /jsonapi/custom/thing': () => ({ status: 201, body: { data: { type: 'custom', id: 'x' } } }) } }] })
    expect(own.handle('POST', `${BASE}/jsonapi/custom/thing`, content, '{}').status).toBe(201)
    expect(onWrite).not.toHaveBeenCalled()
    const api = createMock(dump, { baseUrl: BASE, basePath: '/api', extensions: [{ onWrite }] })
    const editor = { ...content, authorization: `Bearer ${api.tokenFor('umami', ['editor']).access}` }
    expect(api.handle('PATCH', `${BASE}/api/node/recipe/r-1`, editor, body).status).toBe(200)
    expect(onWrite).toHaveBeenCalledTimes(1)
    const failing = createMock(dump, { baseUrl: BASE, extensions: [{ name: 'broken', onWrite: () => { throw new Error('no site') } }] })
    const headers = { ...content, authorization: `Bearer ${failing.tokenFor('umami', ['editor']).access}` }
    expect(failing.handle('PATCH', `${BASE}/jsonapi/node/recipe/r-1`, headers, body).status).toBe(200)
    expect(failing.requests().at(-1)?.errors).toEqual(['broken: no site'])
    const saved = failing.handle('GET', `${BASE}/jsonapi/node/recipe/r-1`, headers).body as { data: { attributes: { title: string } } }
    expect(saved.data.attributes.title).toBe('Changed')
  })

  it('gives a handler the stock site, so reading its own URL does not call itself', () => {
    const route: Extension = { routes: { 'GET /jsonapi/node/page/:id': ({ url, drupal }) => ({ body: { wrapped: drupal.handle('GET', url.href).status } }) } }
    const answer: Extension = { answer: ({ url, drupal }, next) => (url.searchParams.has('direct') ? drupal.handle('GET', `${url.origin}${url.pathname}`) : next()) }
    const mock = createMock(dump, { baseUrl: BASE, extensions: [route, answer] })
    expect(mock.handle('GET', `${BASE}/jsonapi/node/page/p-1`).body).toEqual({ wrapped: 200 })
    expect(mock.handle('GET', `${BASE}/jsonapi/node/page/p-1?direct=1`).status).toBe(200)
  })

  it('refuses a clock moved by something that is not a number, and fixtures through use()', () => {
    const mock = createMock(dump, { baseUrl: BASE })
    expect(() => mock.advanceTime(Number.NaN)).toThrow('advanceTime takes a number of seconds, not NaN.')
    expect(() => mock.use({ name: 'late', fixtures: { en: {} } })).toThrow('The extension late has fixtures, which use() cannot add')
    expect(() => mock.use({ name: 'late', overlay: { recorded: {} } })).toThrow('The extension late has an overlay, which use() cannot add')
  })

  it('takes all of that from another process over the control routes', async () => {
    const mock = createMock(dump, { baseUrl: 'http://127.0.0.1', extensions: [{ scenarios: { down: { answer: () => ({ status: 503, body: 'down' }) } } }] })
    const { url, close } = await listen(mock, 0, '127.0.0.1', { control: true })
    try {
      const client = connectMock(url)
      await client.scenario('down')
      expect((await fetch(`${url}/jsonapi`)).status).toBe(503)
      await expect(client.scenario('nope')).rejects.toThrow('No extension names')
      expect((await client.requests()).map((request) => request.status)).toEqual([503])
      await client.reset()
      expect((await fetch(`${url}/jsonapi`)).status).toBe(200)
      const token = await client.tokenFor('umami')
      await client.advanceTime(3600)
      expect((await fetch(`${url}/jsonapi/node/page`, { headers: { authorization: `Bearer ${token.access}` } })).status).toBe(401)
      expect(await client.sent()).toEqual([])
    } finally {
      await close()
    }
  })
})

describe('a recorded overlay', () => {
  it('replaces and removes what the preset recorded, and leaves the dump alone', () => {
    const before = Object.keys(dump.recorded).length
    const [key] = Object.keys(dump.recorded)
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ overlay: { recorded: { 'GET /only/in/the/overlay': { status: 200, headers: { 'content-type': 'application/json' }, body: { ok: true } } }, removed: [key!], resources: { en: { 'thing--thing': [{ type: 'thing--thing', id: 't-1', attributes: {}, relationships: {} }] } }, index: { es: { links: {} } }, access: { en: { 'node--page': { hidden: ['field_code'] } } } } }] })
    expect(mock.handle('GET', `${BASE}/only/in/the/overlay`).body).toEqual({ ok: true })
    // Its resources and index replace the preset's, language by language.
    expect((mock.handle('GET', `${BASE}/jsonapi/thing/thing/t-1`).body as { data: { id: string } }).data.id).toBe('t-1')
    expect((mock.handle('GET', `${BASE}/es/jsonapi`).body as { links: object }).links).toEqual({})
    expect(Object.keys(dump.recorded)).toHaveLength(before)
    expect((mock.handle('GET', `${BASE}/jsonapi/node/page/p-1`).body as { data: { attributes: object } }).data.attributes).not.toHaveProperty('field_code')
    // The recording it removes is not served, where the stock mock serves it.
    const [method, path] = key!.split(' ') as [string, string]
    const stock = createMock(dump, { baseUrl: BASE })
    const served = stock.handle(method, `${BASE}${path}`)
    expect(served.status).toBe(dump.recorded[key!]!.status)
    expect(mock.handle(method, `${BASE}${path}`)).not.toEqual(served)
  })

  it('takes away a type the recording does not have', () => {
    const stock = createMock(dump, { baseUrl: BASE })
    expect(stock.handle('GET', `${BASE}/jsonapi/node/page`).status).toBe(200)
    const links = Object.fromEntries(Object.entries(dump.index.en!.links || {}).filter(([type]) => type !== 'node--page'))
    const index = { ...dump.index, en: { ...dump.index.en!, links } as typeof dump.index.en & object }
    const mock = createMock(dump, { baseUrl: BASE, extensions: [{ overlay: { removedTypes: { en: ['node--page'] }, index } }] })
    expect(mock.handle('GET', `${BASE}/jsonapi/node/page`).status).toBe(404)
  })
})

