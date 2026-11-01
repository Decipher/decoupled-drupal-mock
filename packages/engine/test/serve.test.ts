import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { createDrupal, handlers } from '../src'
import { connectMock } from '../src/control'
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
      const accounts = (dump.resources.en?.['user--user'] || []).map((user) => (user.attributes as { name?: string, display_name?: string }).name).filter(Boolean) as string[]
      if (accounts[0]) expect((await client.tokenFor(accounts[0])).access.split('.')).toHaveLength(3)
    } finally {
      await on.close()
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
      const status = await new Promise<number>((resolve, reject) => {
        const socket = connect(Number(port), '127.0.0.1', () => socket.write('OPTIONS * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
        let reply = ''
        socket.on('data', (chunk) => { reply += chunk.toString() })
        socket.on('end', () => resolve(Number(reply.split(' ')[1])))
        socket.on('error', reject)
      })
      expect(status).toBeLessThan(500)
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
