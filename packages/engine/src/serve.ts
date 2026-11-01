import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { Drupal } from './engine.js'

/**
 * An HTTP server answering as the Drupal would, for an end-to-end suite or a developer's browser.
 *
 * @param drupal - The engine, created with the base URL the server is reached at.
 * @param port - The port, or 0 for one the system picks.
 */
export const listen = (drupal: Drupal, port = 0, host = '127.0.0.1'): Promise<{ server: Server, url: string, close: () => Promise<void> }> => new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers[name] = value
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const requestBody = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined
      const { status, headers: responseHeaders, body } = drupal.handle(request.method || 'GET', `http://${host}:${port}${request.url || '/'}`, headers, requestBody)
      const text = status === 204 ? '' : typeof body === 'string' ? body : JSON.stringify(body)
      response.writeHead(status, { ...responseHeaders, ...(status === 204 ? {} : { 'content-length': Buffer.byteLength(text) }) })
      response.end(request.method === 'HEAD' || status === 204 ? undefined : text)
    })
  })
  server.on('error', reject)
  server.listen(port, host, () => {
    const address = server.address()
    const bound = typeof address === 'object' && address ? address.port : port
    resolve({ server, url: `http://${host}:${bound}`, close: () => new Promise((done) => server.close(() => done())) })
  })
})
