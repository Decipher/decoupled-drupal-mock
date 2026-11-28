import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { CONTROL_PATH } from './control.js'
import type { Drupal } from './engine.js'
import type { ExtendedDrupal } from './extend.js'

export interface ListenOptions {
  /** The dump directory, whose `files/` answers `/sites/default/files/...` as Drupal's public files directory does. */
  files?: string
  /** CORS for a browser-side client, on unless told otherwise: any origin, the usual headers, a preflight answered. */
  cors?: boolean
  /**
   * CORS as a Drupal answers it with `supportsCredentials` on: the request's own origin instead of `*`, and
   * credentials allowed, so a browser on another origin can send its session cookie. Off unless asked for.
   */
  credentials?: boolean
  /**
   * The origins that CORS with credentials names, as Drupal's `allowedOrigins` lists them. Any other origin gets no
   * origin back. Without a list, only a loopback origin, such as `http://localhost:3000`, is named.
   */
  origins?: string[]
  /** The routes a test uses from another process, to reset the writes and to sign in. Off unless asked for, and only for a test's server. */
  control?: boolean
  /**
   * Milliseconds to wait before an answer, for a test that needs a request still in flight: a number for every request,
   * or by path, such as `{ '/jsonapi/node/recipe': 200 }`. A path takes the paths under it too, with or without a
   * language prefix, and the longest matching path decides. The control routes are never delayed.
   */
  delay?: number | Record<string, number>
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

/** The longest delay a timer takes: past it, Node fires at once. */
const LONGEST = 2147483647

/** Sets a path's delay: `/` is every path. */
const setDelay = (map: Map<string, number>, ms: unknown, path: unknown = '/'): void => {
  if (typeof ms !== 'number' || !(ms >= 0 && ms <= LONGEST) || typeof path !== 'string' || path[0] !== '/') throw new Error(`A delay is a number of milliseconds up to ${LONGEST} for a path that starts with /, not ${String(ms)} for ${String(path)}.`)
  map.set(path, ms)
}

/** The delays a server starts with, by path: a number is one for every path. */
const delays = (delay: ListenOptions['delay']): Map<string, number> => {
  const map = new Map<string, number>()
  for (const [path, ms] of Object.entries(typeof delay === 'number' ? { '/': delay } : delay || {})) setDelay(map, ms, path)
  return map
}

/** The delay for a path: the longest path named that it is or is under, with or without its language prefix. */
const delayFor = (map: Map<string, number>, prefixes: string[], path: string): number => {
  // A prefix is matched whole, as the engine matches it, so `/languages/es` is one. `/es` alone is under `/` already,
  // so the path after its prefix is only asked when there is one.
  const prefix = prefixes.find((candidate) => path === `/${candidate}` || path.startsWith(`/${candidate}/`))
  const paths = prefix ? [path, path.slice(prefix.length + 1)] : [path]
  const named = [...map.keys()].filter((key) => paths.some((candidate) => candidate === key || candidate.startsWith(key.endsWith('/') ? key : `${key}/`)))
  return map.get(named.sort((a, b) => b.length - a.length)[0] ?? '') || 0
}

/**
 * An HTTP server answering as the Drupal would, for a frontend pointed at it, an end-to-end suite or a developer's
 * browser.
 *
 * @param drupal - The engine, created with the base URL the server is reached at.
 * @param port - The port, or 0 for one the system picks.
 * @param host - The interface to listen on: `0.0.0.0` for a devpod with the port forwarded.
 * @param options - The public files directory and CORS.
 */
/** A test's order to a server: reset, a token for a user, or a delay. */
const control = (drupal: Drupal | ExtendedDrupal, delay: { now: Map<string, number>, start: ListenOptions['delay'] }, order: string, body: string | undefined): { status: number, text: string } => {
  const extended = 'scenario' in drupal ? drupal : undefined
  try {
    const given = JSON.parse(body || '{}') as { name?: string, scopes?: string[], seconds?: number, ms?: number, path?: string }
    if (order === 'reset') {
      drupal.reset()
      delay.now = delays(delay.start)
    } else if (order === 'delay') setDelay(delay.now, given.ms, given.path)
    else if (order === 'token') return { status: 200, text: JSON.stringify(drupal.tokenFor(given.name || '', given.scopes)) }
    else if (extended && order === 'scenario') extended.scenario(given.name || '')
    else if (extended && order === 'requests') return { status: 200, text: JSON.stringify(extended.requests()) }
    else if (extended && order === 'sent') return { status: 200, text: JSON.stringify(extended.sent()) }
    else if (extended && order === 'time') extended.advanceTime(given.seconds || 0)
    else return { status: 404, text: JSON.stringify({ message: `No order named ${order}.` }) }
    return { status: 200, text: '{}' }
  } catch (error) {
    return { status: 400, text: JSON.stringify({ message: (error as Error).message }) }
  }
}

/** A host as a URL names it: an IPv6 address goes in brackets. */
const urlHost = (host: string): string => (host.includes(':') && !host.startsWith('[') ? `[${host}]` : host)

/** A loopback origin, which only a page on the developer's own machine can send. */
const loopback = (origin: string): boolean => {
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname)
  } catch {
    return false
  }
}

/**
 * The CORS headers for one request. With credentials, Drupal names an allowed origin, says credentials are allowed,
 * and varies on the origin. An origin it does not allow, or a request with none, gets no origin back. A sandboxed
 * frame's `null` is never named unless it is listed.
 */
const corsHeaders = (options: ListenOptions, origin: string | undefined): Record<string, string> => {
  if (options.cors === false) return {}
  if (!options.credentials) return CORS
  const rest = Object.fromEntries(Object.entries(CORS).filter(([name]) => name !== 'access-control-allow-origin'))
  // A sandboxed frame's `null` is never named, even from a list that holds it.
  const allowed = origin !== undefined && origin !== 'null' && (options.origins?.length ? options.origins.includes(origin) : loopback(origin))
  return { ...rest, vary: 'Origin', ...(allowed ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {}) }
}

/**
 * The answer's headers under CORS's. An answer's own `Vary` keeps its fields, and gains `Origin` when CORS names it, as
 * Drupal's CORS middleware adds to the `Vary` a response already has. Otherwise a cache could give an answer to a request
 * with no origin to an allowed origin later. `Vary: *` stays as it is.
 *
 * @param cors - The CORS headers for this request.
 * @param answer - The headers the engine or an extension answered with.
 */
const withCors = (cors: Record<string, string>, answer: Record<string, string>): Record<string, string> => {
  const name = Object.keys(answer).find((key) => key.toLowerCase() === 'vary')
  if (!cors.vary || !name) return { ...cors, ...answer }
  const { [name]: own, ...rest } = answer
  const fields = own!.split(',').map((field) => field.trim()).filter(Boolean)
  const vary = fields.includes('*') ? '*' : [...fields, ...(fields.some((field) => field.toLowerCase() === 'origin') ? [] : [cors.vary])].join(', ')
  return { ...cors, ...rest, vary }
}

export const listen = (drupal: Drupal, port = 0, host = '127.0.0.1', options: ListenOptions = {}): Promise<{ server: Server, url: string, close: () => Promise<void> }> => new Promise((resolve, reject) => {
  const delay = { now: delays(options.delay), start: options.delay }
  // The longest prefix first, so one that starts another is not taken for it.
  const prefixes = Object.values(drupal.manifest.languages).filter(Boolean).sort((a, b) => b.length - a.length)
  // The requests still waiting, answered at once when the server closes.
  const waiting = new Map<NodeJS.Timeout, () => void>()
  const server = createServer((request, response) => {
    let ms = 0
    try {
      // An http.Server's request always has its target. Only a client's request has none.
      const { pathname } = new URL(request.url!, 'http://localhost')
      if (!(options.control && pathname.startsWith(`${CONTROL_PATH}/`))) ms = delayFor(delay.now, prefixes, pathname)
    } catch {
      // A target no URL can be made of is not delayed, and the engine answers it.
    }
    if (!ms) return answer(request, response)
    const run = (): void => {
      waiting.delete(timer)
      answer(request, response)
    }
    const timer = setTimeout(run, ms)
    waiting.set(timer, run)
    // A client that leaves before its answer takes its timer with it.
    response.on('close', () => {
      clearTimeout(timer)
      waiting.delete(timer)
    })
  })
  const answer = (request: IncomingMessage, response: ServerResponse): void => {
    const method = request.method || 'GET'
    const cors = corsHeaders(options, typeof request.headers.origin === 'string' ? request.headers.origin : undefined)
    if (method === 'OPTIONS' && options.cors !== false) {
      response.writeHead(204, cors)
      response.end()
      return
    }
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
      // A request target no URL can be made of fails this request and not the server.
      try {
        const requestBody = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined
        if (options.control && method === 'POST' && request.url?.startsWith(`${CONTROL_PATH}/`)) {
          const ordered = control(drupal, delay, request.url.slice(CONTROL_PATH.length + 1), requestBody)
          response.writeHead(ordered.status, { ...cors, 'content-type': 'application/json' })
          response.end(ordered.text)
          return
        }
        const { status, headers: responseHeaders, body } = drupal.handle(method, `http://${urlHost(host)}:${port}${request.url || '/'}`, headers, requestBody)
        const text = status === 204 || body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
        response.writeHead(status, { ...withCors(cors, responseHeaders), ...(status === 204 ? {} : { 'content-length': Buffer.byteLength(text) }) })
        response.end(method === 'HEAD' || status === 204 ? undefined : text)
      } catch {
        response.writeHead(400, { ...cors, 'content-type': 'text/plain' })
        response.end('Bad Request')
      }
    })
  }
  server.on('error', reject)
  server.listen(port, host, () => {
    const address = server.address()
    const bound = typeof address === 'object' && address ? address.port : port
    const close = (): Promise<void> => new Promise((done) => {
      server.close(() => done())
      for (const [timer, run] of waiting) {
        clearTimeout(timer)
        run()
      }
    })
    resolve({ server, url: `http://${urlHost(host)}:${bound}`, close })
  })
})
