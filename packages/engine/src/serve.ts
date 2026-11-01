import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { Drupal } from './engine.js'

/**
 * An HTTP server answering as the Drupal would, for an end-to-end suite or a developer's browser.
 *
 * @param drupal - The engine, created with the base URL the server is reached at.
 * @param port - The port, or 0 for one the system picks.
 * @param host - The interface to listen on.
 * @param options - CORS.
 */
export interface ListenOptions {
  /** CORS for a browser-side client, on unless told otherwise: any origin, the usual headers, a preflight answered. */
  cors?: boolean
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'Accept, Authorization, Content-Type, X-CSRF-Token',
  'access-control-expose-headers': 'Location',
  'access-control-max-age': '86400',
}

/** A host as a URL names it: an IPv6 address goes in brackets. */
const urlHost = (host: string): string => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host)

export const listen = (drupal: Drupal, port = 0, host = '127.0.0.1', options: ListenOptions = {}): Promise<{ server: Server, url: string, close: () => Promise<void> }> => new Promise((resolve, reject) => {
  const cors = options.cors !== false ? CORS : {}
  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS' && options.cors !== false) {
      response.writeHead(204, cors)
      response.end()
      return
    }
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers[name] = value
    // A request target no URL can be made of, such as `OPTIONS *`, fails this request and not the server.
    try {
      const { status, headers: responseHeaders, body } = drupal.handle(request.method || 'GET', `http://${urlHost(host)}:${port}${request.url || '/'}`, headers)
      const text = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)
      response.writeHead(status, { ...cors, ...responseHeaders, 'content-length': Buffer.byteLength(text) })
      response.end(request.method === 'HEAD' ? undefined : text)
    } catch {
      response.writeHead(400, { ...cors, 'content-type': 'text/plain' })
      response.end('Bad Request')
    }
  })
  server.on('error', reject)
  server.listen(port, host, () => {
    const address = server.address()
    const bound = typeof address === 'object' && address ? address.port : port
    resolve({ server, url: `http://${urlHost(host)}:${bound}`, close: () => new Promise((done) => server.close(() => done())) })
  })
})
