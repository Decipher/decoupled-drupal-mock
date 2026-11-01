import { connect } from 'node:net'
import { describe, expect, it } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { createDrupal, handlers } from '../src'
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
    } finally {
      await close()
    }
  })

  it('answers through msw handlers', async () => {
    const drupal = createDrupal(dump, { baseUrl: 'https://drupal.test' })
    const server = setupServer(...(handlers(drupal, http, 'https://drupal.test') as Parameters<typeof setupServer>))
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
