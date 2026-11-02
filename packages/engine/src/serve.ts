import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import type { Drupal } from './engine.js'

/**
 * An HTTP server answering as the Drupal would, for an end-to-end suite or a developer's browser.
 *
 * @param drupal - The engine, created with the base URL the server is reached at.
 * @param port - The port, or 0 for one the system picks.
 * @param host - The interface to listen on.
 * @param options - The public files directory and CORS.
 */
export interface ListenOptions {
  /** The dump directory, whose `files/` answers `/sites/default/files/...` as Drupal's public files directory does. */
  files?: string
  /** CORS for a browser-side client, on unless told otherwise: any origin, the usual headers, a preflight answered. */
  cors?: boolean
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.txt': 'text/plain', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' }

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'Accept, Authorization, Content-Type, X-CSRF-Token',
  'access-control-expose-headers': 'Location',
  'access-control-max-age': '86400',
}

/**
 * The public file a request names, from the dump's `files/`: a path under `/sites/default/files/`, or an image style
 * derivative's path answered with the original, since no Drupal is there to derive one.
 */
export const publicFile = (dir: string, pathname: string): { path: string, mime: string } | undefined => {
  const prefix = '/sites/default/files/'
  if (!pathname.startsWith(prefix)) return undefined
  let rest = decodeURIComponent(pathname.slice(prefix.length))
  const style = rest.match(/^styles\/[^/]+\/public\/(.+)$/)
  if (style) rest = style[1]!
  const path = normalize(join(dir, 'files', rest))
  if (!path.startsWith(normalize(join(dir, 'files')) + '/') || !existsSync(path) || !statSync(path).isFile()) return undefined
  return { path, mime: MIME[extname(path).toLowerCase()] || 'application/octet-stream' }
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
    const method = request.method || 'GET'
    let file: ReturnType<typeof publicFile>
    try {
      if (options.files) file = publicFile(options.files, new URL(request.url || '/', `http://${urlHost(host)}:${port}`).pathname)
    } catch {
      // A target or an escape that does not parse names no file, and the engine answers it.
    }
    if (file && (method === 'GET' || method === 'HEAD')) {
      const bytes = readFileSync(file.path)
      response.writeHead(200, { ...cors, 'content-type': file.mime, 'content-length': bytes.length, 'cache-control': 'max-age=1209600' })
      response.end(method === 'HEAD' ? undefined : bytes)
      return
    }
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers[name] = value
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      // A request target no URL can be made of, such as `OPTIONS *`, fails this request and not the server.
      try {
        const requestBody = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined
        const { status, headers: responseHeaders, body } = drupal.handle(request.method || 'GET', `http://${urlHost(host)}:${port}${request.url || '/'}`, headers, requestBody)
        const text = status === 204 || body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
        response.writeHead(status, { ...cors, ...responseHeaders, ...(status === 204 ? {} : { 'content-length': Buffer.byteLength(text) }) })
        response.end(request.method === 'HEAD' || status === 204 ? undefined : text)
      } catch {
        response.writeHead(400, { ...cors, 'content-type': 'text/plain' })
        response.end('Bad Request')
      }
    })
  })
  server.on('error', reject)
  server.listen(port, host, () => {
    const address = server.address()
    const bound = typeof address === 'object' && address ? address.port : port
    resolve({ server, url: `http://${urlHost(host)}:${bound}`, close: () => new Promise((done) => server.close(() => done())) })
  })
})
