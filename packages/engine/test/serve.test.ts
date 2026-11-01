import { describe, expect, it } from 'vitest'
import { http } from 'msw'
import { setupServer } from 'msw/node'
import { createDrupal, handlers } from '../src'
import { listen } from '../src/serve'
import { dump } from './dump'

describe('serving', () => {
  it('answers over HTTP as the engine does', async () => {
    // A port of its own, so the engine's links name the server's own URL; another try when the port is taken.
    let bound: Awaited<ReturnType<typeof listen>> | undefined
    for (let attempt = 0; attempt < 5 && !bound; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000)
      bound = await listen(createDrupal(dump, { baseUrl: `http://127.0.0.1:${port}` }), port).catch(() => undefined)
    }
    const { url, close } = bound!
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
