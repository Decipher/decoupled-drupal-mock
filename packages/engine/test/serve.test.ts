import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { createDrupal, createMock, handlers } from '../src'
import { connectMock } from '../src/control'
import { cypressTasks } from '../src/runner'
import { listen } from '../src/serve'
import { dump } from './dump'

/** A port of its own, so the engine's links name the server's own URL; another try when the port is taken. */
const bind = async (host = '127.0.0.1') => {
  for (let attempt = 0; ; attempt++) {
    const port = 40000 + Math.floor(Math.random() * 20000)
    try {
      return await listen(createDrupal(dump, { baseUrl: `http://${host.includes(':') ? `[${host}]` : host}:${port}` }), port, host)
    } catch (error) {
      if (attempt === 4) throw error
    }
  }
}

/** The status a request line gets, sent as it is, with no URL parser between. */
const raw = (port: number, line: string): Promise<number> => new Promise((resolve, reject) => {
  const socket = connect(port, '127.0.0.1', () => socket.write(`${line} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`))
  let reply = ''
  socket.on('data', (chunk) => { reply += chunk.toString() })
  socket.on('end', () => resolve(Number(reply.split(' ')[1])))
  socket.on('error', reject)
})

/** How long a GET takes to answer, in milliseconds. */
const timed = async (url: string): Promise<number> => {
  const start = performance.now()
  await (await fetch(url)).arrayBuffer()
  return performance.now() - start
}

describe('serving', () => {
  it('takes a test\'s orders only when asked to', async () => {
    const off = await bind()
    try {
      await expect(connectMock(off.url).reset()).rejects.toThrow('start it with --control')
    } finally {
      await off.close()
    }
    const drupal = createDrupal(dump, { baseUrl: 'http://127.0.0.1' })
    const on = await listen(drupal, 0, '127.0.0.1', { control: true })
    try {
      const client = connectMock(on.url)
      await client.reset()
      await expect(client.tokenFor('nobody-at-all')).rejects.toThrow('No user named')
      const malformed = await fetch(`${on.url}/__decoupled-drupal-mock/token`, { method: 'POST', body: '{' })
      expect(malformed.status).toBe(400)
      expect(Object.keys(await malformed.json() as object)).toEqual(['message'])
      const accounts = (dump.resources.en?.['user--user'] || []).map((user) => (user.attributes as { name?: string, display_name?: string }).name).filter(Boolean) as string[]
      if (accounts[0]) expect((await client.tokenFor(accounts[0])).access.split('.')).toHaveLength(3)
    } finally {
      await on.close()
    }
  })

  it('delays the answers under a path, and only those', async () => {
    const { url, close } = await listen(createDrupal(dump, { baseUrl: 'http://127.0.0.1' }), 0, '127.0.0.1', { delay: { '/jsonapi/node/recipe': 200 } })
    try {
      const [slow, fast] = await Promise.all([timed(`${url}/jsonapi/node/recipe?page[limit]=1`), timed(`${url}/jsonapi`)])
      expect(slow).toBeGreaterThanOrEqual(190)
      expect(fast).toBeLessThan(slow)
      // A path under it waits too, and one that only starts with the same letters does not.
      expect(await timed(`${url}/jsonapi/node/recipe/r-1`)).toBeGreaterThanOrEqual(190)
      expect(await timed(`${url}/es/jsonapi/node/recipe`)).toBeGreaterThanOrEqual(190)
      expect(await timed(`${url}/jsonapi/node/recipes`)).toBeLessThan(190)
    } finally {
      await close()
    }
  })

  it('delays every answer, and the longest matching path decides', async () => {
    const { url, close } = await listen(createDrupal(dump, { baseUrl: 'http://127.0.0.1' }), 0, '127.0.0.1', { delay: 200 })
    try {
      expect(await timed(`${url}/jsonapi`)).toBeGreaterThanOrEqual(190)
      // A target no URL can be made of is answered at once, as the engine answers it.
      const start = performance.now()
      expect(await raw(Number(new URL(url).port), 'GET //')).toBeLessThan(500)
      expect(performance.now() - start).toBeLessThan(190)
    } finally {
      await close()
    }
    const both = await listen(createDrupal(dump, { baseUrl: 'http://127.0.0.1' }), 0, '127.0.0.1', { delay: { '/': 200, '/jsonapi': 0 } })
    try {
      expect(await timed(`${both.url}/jsonapi`)).toBeLessThan(190)
      expect(await timed(`${both.url}/router/translate-path?path=/`)).toBeGreaterThanOrEqual(190)
    } finally {
      await both.close()
    }
  })

  it('refuses a starting delay no timer can wait for', async () => {
    await expect(listen(createDrupal(dump), 0, '127.0.0.1', { delay: 2147483648 })).rejects.toThrow('not 2147483648 for /')
    await expect(listen(createDrupal(dump), 0, '127.0.0.1', { delay: { jsonapi: 10 } })).rejects.toThrow('not 10 for jsonapi')
  })

  it('delays a path under a language prefix of more than one segment', async () => {
    const nested = { ...dump, manifest: { ...dump.manifest, languages: { en: '', es: 'languages/es' } } }
    const { url, close } = await listen(createDrupal(nested, { baseUrl: 'http://127.0.0.1' }), 0, '127.0.0.1', { delay: { '/jsonapi/node/recipe': 200 } })
    try {
      expect(await timed(`${url}/languages/es/jsonapi/node/recipe`)).toBeGreaterThanOrEqual(190)
      expect(await timed(`${url}/languages/jsonapi/node/recipe`)).toBeLessThan(190)
    } finally {
      await close()
    }
  })

  it('drops the timer of a request whose client leaves, and answers the rest when it closes', async () => {
    const set = vi.spyOn(globalThis, 'setTimeout')
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    const { url, close } = await listen(createDrupal(dump, { baseUrl: 'http://127.0.0.1' }), 0, '127.0.0.1', { delay: 60000 })
    // The timers the server set for a request's delay.
    const delays = () => set.mock.calls.flatMap(([, ms], index) => (ms === 60000 ? [set.mock.results[index]!.value as NodeJS.Timeout] : []))
    try {
      const left = new AbortController()
      const leaving = fetch(`${url}/jsonapi`, { signal: left.signal }).catch(() => undefined)
      await vi.waitFor(() => expect(delays()).toHaveLength(1))
      left.abort()
      await leaving
      await vi.waitFor(() => expect(cleared).toHaveBeenCalledWith(delays()[0]))
      const waiting = fetch(`${url}/jsonapi`)
      await vi.waitFor(() => expect(delays()).toHaveLength(2))
      const started = performance.now()
      await close()
      expect(performance.now() - started).toBeLessThan(5000)
      expect((await waiting).status).toBe(200)
      expect(cleared).toHaveBeenCalledWith(delays()[1])
    } finally {
      set.mockRestore()
      cleared.mockRestore()
    }
  })

  it('sets and clears a delay over the control route, which reset() puts back', async () => {
    const { url, close } = await listen(createDrupal(dump, { baseUrl: 'http://127.0.0.1' }), 0, '127.0.0.1', { control: true, delay: { '/jsonapi/node/article': 200 } })
    try {
      const client = connectMock(url)
      expect(await timed(`${url}/jsonapi/node/recipe`)).toBeLessThan(190)
      await client.delay(200, '/jsonapi/node/recipe')
      expect(await timed(`${url}/jsonapi/node/recipe`)).toBeGreaterThanOrEqual(190)
      await client.delay(0, '/jsonapi/node/recipe')
      expect(await timed(`${url}/jsonapi/node/recipe`)).toBeLessThan(190)
      await client.delay(200)
      expect(await timed(`${url}/jsonapi`)).toBeGreaterThanOrEqual(190)
      await client.reset()
      expect(await timed(`${url}/jsonapi`)).toBeLessThan(190)
      // reset() puts back the delay the server started with.
      expect(await timed(`${url}/jsonapi/node/article`)).toBeGreaterThanOrEqual(190)
      await expect(client.delay(-1)).rejects.toThrow('A delay is a number of milliseconds')
      await expect(client.delay(10, 'jsonapi')).rejects.toThrow('not 10 for jsonapi')
      // Past the largest delay a timer takes, Node fires at once, so the request would not wait.
      await expect(client.delay(2147483648)).rejects.toThrow('not 2147483648 for /')
      await expect(cypressTasks(url)['drupal:delay']({ ms: 200, path: '/jsonapi' })).resolves.toBeNull()
      expect(await timed(`${url}/jsonapi`)).toBeGreaterThanOrEqual(190)
    } finally {
      await close()
    }
  })

  it('answers CORS for a browser-side client and a preflight, unless told not to', async () => {
    const { url, close } = await bind()
    try {
      const preflight = await fetch(`${url}/jsonapi`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
      const answer = await fetch(`${url}/jsonapi/node/page/p-1`, { headers: { origin: 'http://localhost:3000' } })
      expect(answer.headers.get('access-control-allow-origin')).toBe('*')
      expect(answer.headers.get('content-type')).toBe('application/vnd.api+json')
    } finally {
      await close()
    }
    const quiet = await listen(createDrupal(dump), 0, '127.0.0.1', { cors: false })
    try {
      expect((await fetch(`${quiet.url}/jsonapi`)).headers.get('access-control-allow-origin')).toBeNull()
      expect((await fetch(`${quiet.url}/jsonapi`, { method: 'OPTIONS' })).status).not.toBe(204)
    } finally {
      await quiet.close()
    }
  })

  it('survives a request target no URL can be made of, and listens on IPv6', async () => {
    const { url, close } = await bind()
    try {
      const { port } = new URL(url)
      expect(await raw(Number(port), 'OPTIONS *')).toBeLessThan(500)
      expect((await fetch(`${url}/jsonapi`)).status).toBe(200)
    } finally {
      await close()
    }
    const six = await bind('::1').catch(() => undefined)
    if (six) {
      try {
        expect(six.url).toMatch(/^http:\/\/\[::1\]:/)
        expect((await fetch(`${six.url}/jsonapi`)).status).toBe(200)
      } finally {
        await six.close()
      }
    }
  })

  it('answers over HTTP as the engine does', async () => {
    const { url, close } = await bind()
    try {
      const response = await fetch(`${url}/jsonapi/node/page/p-1`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/vnd.api+json')
      const document = await response.json() as { data: { attributes: { title: string } }, links: { self: { href: string } } }
      expect(document.data.attributes.title).toBe('About Umami')
      expect(document.links.self.href).toBe(`${url}/jsonapi/node/page/p-1`)
      expect((await fetch(`${url}/nope`)).status).toBe(404)
      // A write over HTTP, with its body read.
      const token = await (await fetch(`${url}/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'druxt', client_secret: 's3cret' }) })).json() as { access_token: string }
      const created = await fetch(`${url}/jsonapi/node/page`, { method: 'POST', headers: { 'content-type': 'application/vnd.api+json', authorization: `Bearer ${token.access_token}` }, body: JSON.stringify({ data: { type: 'node--page', attributes: { title: 'Over HTTP' } } }) })
      expect(created.status).toBe(201)
      expect(created.headers.get('location')).toContain(`${url}/jsonapi/node/page/`)
      const gone = await fetch(created.headers.get('location')!.split('?')[0]!, { method: 'DELETE', headers: { authorization: `Bearer ${token.access_token}` } })
      expect(gone.status).toBe(204)
    } finally {
      await close()
    }
  })

  it('answers through msw handlers', async () => {
    const drupal = createDrupal(dump, { baseUrl: 'https://drupal.test' })
    const server = setupServer(...handlers(drupal, http, 'https://drupal.test'))
    server.listen()
    try {
      const response = await fetch('https://drupal.test/jsonapi/node/recipe?filter[field_difficulty]=easy')
      expect(response.status).toBe(200)
      const document = await response.json() as { data: { id: string }[] }
      expect(document.data.map((resource) => resource.id)).toEqual(['r-3'])
    } finally {
      server.close()
    }
  })
})

describe('the server as a backend for a frontend', () => {
  const bind = async (options: Parameters<typeof listen>[3]) => {
    for (let attempt = 0; ; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000)
      try {
        return await listen(createDrupal(dump, { baseUrl: `http://127.0.0.1:${port}` }), port, '127.0.0.1', options)
      } catch (error) {
        if (attempt === 4) throw error
      }
    }
  }

  it('answers CORS for a browser-side client, and a preflight, unless told not to', async () => {
    const { url, close } = await bind({})
    try {
      const preflight = await fetch(`${url}/jsonapi`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' } })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
      const answer = await fetch(`${url}/jsonapi/node/page/p-1`, { headers: { origin: 'http://localhost:3000' } })
      expect(answer.headers.get('access-control-allow-origin')).toBe('*')
      expect(answer.headers.get('content-type')).toBe('application/vnd.api+json')
    } finally {
      await close()
    }
    const quiet = await bind({ cors: false })
    try {
      expect((await fetch(`${quiet.url}/jsonapi`)).headers.get('access-control-allow-origin')).toBeNull()
      expect((await fetch(`${quiet.url}/jsonapi`, { method: 'OPTIONS' })).status).not.toBe(204)
    } finally {
      await quiet.close()
    }
  })

  // As a Drupal 11.4 site answered with `supportsCredentials: true` in its cors.config: an allowed origin named, with
  // credentials, on a preflight and an answer alike, and an origin it does not allow, or none, given no origin back.
  // With `allowedOrigins` naming two origins, a sandboxed frame's `null` got none either.
  it('answers CORS with credentials as Drupal does when asked to, for the origins it allows', async () => {
    const credentialed = async (url: string, origin: string, method = 'GET') => {
      const answer = await fetch(`${url}/jsonapi`, { method, headers: { origin, 'access-control-request-method': 'GET' } })
      return { status: answer.status, origin: answer.headers.get('access-control-allow-origin'), credentials: answer.headers.get('access-control-allow-credentials'), vary: answer.headers.get('vary') }
    }
    // Without a list, only an origin on the developer's own machine.
    const { url, close } = await bind({ credentials: true })
    try {
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
        expect(await credentialed(url, origin, 'OPTIONS')).toEqual({ status: 204, origin, credentials: 'true', vary: 'Origin' })
        expect(await credentialed(url, origin)).toEqual({ status: 200, origin, credentials: 'true', vary: 'Origin' })
      }
      for (const origin of ['null', 'http://drupal.example.com', 'not a url']) {
        expect(await credentialed(url, origin)).toEqual({ status: 200, origin: null, credentials: null, vary: 'Origin' })
      }
      const answer = await fetch(`${url}/jsonapi/node/page/p-1`, { headers: { origin: 'http://localhost:3000' } })
      expect(answer.headers.get('content-type')).toBe('application/vnd.api+json')
      // A request with no origin is not a cross-origin one, so it gets no origin back.
      const plain = await fetch(`${url}/jsonapi`)
      expect(plain.headers.get('access-control-allow-origin')).toBeNull()
      expect(plain.headers.get('vary')).toBe('Origin')
    } finally {
      await close()
    }
    // With a list, the origins in it and nothing else, a loopback origin included.
    const listed = await bind({ credentials: true, origins: ['https://frontend.example.com', 'http://localhost:3000'] })
    try {
      expect(await credentialed(listed.url, 'https://frontend.example.com', 'OPTIONS')).toMatchObject({ status: 204, origin: 'https://frontend.example.com', credentials: 'true' })
      expect((await credentialed(listed.url, 'http://localhost:3000')).origin).toBe('http://localhost:3000')
      for (const origin of ['null', 'http://127.0.0.1:3000', 'https://other.example.com']) {
        expect(await credentialed(listed.url, origin)).toMatchObject({ origin: null, credentials: null })
      }
    } finally {
      await listed.close()
    }
    // Not even from a list that names it.
    const nulled = await bind({ credentials: true, origins: ['null', 'http://localhost:3000'] })
    try {
      expect(await credentialed(nulled.url, 'null')).toMatchObject({ origin: null, credentials: null })
      expect((await credentialed(nulled.url, 'http://localhost:3000')).origin).toBe('http://localhost:3000')
    } finally {
      await nulled.close()
    }
    const quiet = await bind({ cors: false, credentials: true })
    try {
      expect((await fetch(`${quiet.url}/jsonapi`, { headers: { origin: 'http://localhost:3000' } })).headers.get('access-control-allow-origin')).toBeNull()
    } finally {
      await quiet.close()
    }
  })

  // An answer that already varies keeps its fields and gains Origin, as Drupal's CORS middleware adds it to a response's Vary.
  it('adds Origin to the Vary an answer already has, when CORS with credentials names it', async () => {
    const varies = (vary: string) => createMock(dump, { baseUrl: 'http://127.0.0.1', extensions: [{ routes: { 'GET /varies': () => ({ headers: { vary }, body: {} }) } }] })
    for (const [own, sent] of [['Accept-Language', 'Accept-Language, Origin'], ['accept-language, origin', 'accept-language, origin'], ['*', '*']] as const) {
      const { url, close } = await listen(varies(own), 0, '127.0.0.1', { credentials: true })
      try {
        const answer = await fetch(`${url}/varies`, { headers: { origin: 'http://localhost:3000' } })
        expect(answer.headers.get('vary')).toBe(sent)
        expect(answer.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
      } finally {
        await close()
      }
    }
    // Without credentials CORS does not vary, so the answer's own Vary goes out unchanged.
    const { url, close } = await listen(varies('Accept-Language'), 0, '127.0.0.1')
    try {
      expect((await fetch(`${url}/varies`, { headers: { origin: 'http://localhost:3000' } })).headers.get('vary')).toBe('Accept-Language')
    } finally {
      await close()
    }
  })

  it('serves the public files from the dump, an image style with the original, and nothing outside', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mock-files-'))
    mkdirSync(join(dir, 'files', 'a'), { recursive: true })
    writeFileSync(join(dir, 'files', 'a', 'quiche.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    writeFileSync(join(dir, 'secret.txt'), 'not public')
    const { url, close } = await bind({ files: dir })
    try {
      const original = await fetch(`${url}/sites/default/files/a/quiche.jpg`)
      expect(original.status).toBe(200)
      expect(original.headers.get('content-type')).toBe('image/jpeg')
      expect((await original.arrayBuffer()).byteLength).toBe(4)
      const styled = await fetch(`${url}/sites/default/files/styles/medium/public/a/quiche.jpg`)
      expect(styled.status).toBe(200)
      expect((await styled.arrayBuffer()).byteLength).toBe(4)
      expect((await fetch(`${url}/sites/default/files/a/missing.jpg`)).status).toBe(404)
      // `..%2F`, as a URL parser collapses a plain `../` before the request is sent, and it never reaches the check.
      expect((await fetch(`${url}/sites/default/files/..%2Fsecret.txt`)).status).toBe(404)
      expect((await fetch(`${url}/sites/default/files/a/quiche.jpg`, { method: 'HEAD' })).status).toBe(200)
    } finally {
      await close()
    }
  })
})
