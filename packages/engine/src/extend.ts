import { clone } from './clone.js'
import type { Drupal } from './engine.js'
import type { Dump, Resource } from './types.js'
import { withoutTrailingSlashes } from './slashes.js'

/** A request as an extension reads it. */
export interface ExtensionRequest {
  method: string
  url: URL
  path: string
  /** The path without a language prefix the preset knows. */
  route: string
  /** The language prefix the path had, or none. */
  prefix?: string
  /** What a `:name` in the route's pattern matched. */
  params: Record<string, string>
  query: Record<string, string>
  headers: Record<string, string>
  body?: string
  /** The body parsed as JSON, or undefined when it is not. */
  json?: unknown
  /** State the extensions share, dropped on `reset()`. */
  state: Map<string, unknown>
  /** The stock site under every extension, fixtures included, for what a handler reads: `drupal.handle(...)`. */
  drupal: Drupal
}

/** An extension's answer. A `body` that is not a string is sent as JSON. */
export interface ExtensionAnswer {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

type Answered = ReturnType<Drupal['handle']>

/** What a successful JSON:API write gives `onWrite`. */
export interface WriteEvent {
  method: string
  path: string
  /** The resource the answer holds. A DELETE has none. */
  resource?: Resource
  state: Map<string, unknown>
  /** Calls another service, such as a site's revalidate route. The answer lands in `sent()`, and the request does not wait for it. */
  send: (url: string, init?: RequestInit) => void
}

/**
 * What a site's module adds to the mock. Answers must be synchronous, as the engine's are, so a Jest spy can be answered
 * from one: `onWrite`'s `send` is the way out to anything slower.
 */
export interface Extension {
  name?: string
  /** New endpoints, by `METHOD /path`: `POST /next/draft-url`, `GET /api/:id/preview`. `ANY` takes every method. A language prefix is matched for you. */
  routes?: Record<string, (request: ExtensionRequest) => ExtensionAnswer>
  /** Sees every request, and may change, replace or fail what `next` gives. */
  answer?: (request: ExtensionRequest, next: () => Answered) => ExtensionAnswer
  /** Resources the preset's dump does not hold, by language and type. They read and write like the dump's own. */
  fixtures?: Record<string, Record<string, Resource[]>>
  /** What a recording of the site with a module or a patch answers differently: replaces what the preset recorded. See `presets/<name>/overlays`. */
  overlay?: RecordedOverlay
  onWrite?: (event: WriteEvent) => void
  /** Named sets of behaviour a test turns on with `scenario(name)`, from any process. `reset()` turns them off. */
  scenarios?: Record<string, Pick<Extension, 'routes' | 'answer' | 'onWrite'>>
}

/** What a build recorded differently from the preset it overlays. */
export interface RecordedOverlay {
  recorded?: Dump['recorded']
  removed?: string[]
  resources?: Dump['resources']
  index?: Dump['index']
  access?: NonNullable<Dump['access']>
}

/** A request as the mock answered it, for a test's assertions. */
export interface RecordedRequest {
  method: string
  path: string
  search: string
  headers: Record<string, string>
  body?: string
  status: number
  /** What an `onWrite` threw, by extension. The write stands: Drupal's answer has gone back already. */
  errors?: string[]
}

/** A call `send` made, and how it ended. */
export interface SentRequest {
  url: string
  method: string
  status?: number
  error?: string
}

/** The mock with what a test does to it. */
export interface ExtendedDrupal extends Drupal {
  /** Adds an extension for this test: `reset()` drops it. Newest goes first. */
  use: (extension: Extension) => void
  /** Turns on a scenario an extension names. */
  scenario: (name: string) => void
  /** What the mock was asked, oldest first, since the last `reset()`. */
  requests: () => RecordedRequest[]
  /** What `onWrite`'s `send` called, since the last `reset()`. */
  sent: () => SentRequest[]
  /** Moves the mock's clock on, for a token's expiry. `reset()` puts it back. */
  advanceTime: (seconds: number) => void
}

/**
 * A preset's dump with the extensions' fixtures in it.
 *
 * @param dump - The preset's dump, left as it is.
 * @param extensions - The extensions.
 * @returns The dump to create the engine over.
 */
export const withFixtures = (dump: Dump, extensions: Extension[] = []): Dump => {
  const resources = { ...dump.resources }
  let { recorded, index, access } = dump
  for (const { overlay } of extensions) {
    if (!overlay) continue
    recorded = { ...recorded, ...overlay.recorded }
    for (const key of overlay.removed || []) delete recorded[key]
    index = { ...index, ...overlay.index }
    access = { ...access, ...overlay.access }
    for (const [langcode, types] of Object.entries(overlay.resources || {})) resources[langcode] = { ...resources[langcode], ...types }
  }
  for (const extension of extensions) {
    for (const [langcode, types] of Object.entries(extension.fixtures || {})) {
      resources[langcode] = { ...resources[langcode] }
      for (const [type, list] of Object.entries(types)) resources[langcode]![type] = [...(resources[langcode]![type] || []), ...clone(list)]
    }
  }
  return { ...dump, resources, recorded, index, ...(access ? { access } : {}) }
}

const compile = (pattern: string): { method: string, match: RegExp, names: string[] } => {
  const [method, path] = pattern.trim().split(/\s+/) as [string, string?]
  if (!path) throw new Error(`The route "${pattern}" is not "METHOD /path".`)
  const names: string[] = []
  const source = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_whole, name: string) => {
    names.push(name)
    return '([^/]+)'
  })
  return { method: method.toUpperCase(), match: new RegExp(`^${source}$`), names }
}

const settled = (answer: ExtensionAnswer | undefined, name: string): Answered => {
  if (!answer || typeof (answer as { then?: unknown }).then === 'function') throw new Error(`The extension ${name} must answer synchronously, with an object.`)
  const body = answer.body
  const headers = { ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...answer.headers }
  return { status: answer.status ?? 200, headers, body }
}

type Layer = Pick<Extension, 'name' | 'routes' | 'answer' | 'onWrite'>

/**
 * The mock with extensions, a request log and a clock of its own.
 *
 * @param drupal - The engine, created over `withFixtures(dump, extensions)`.
 * @param extensions - The extensions.
 * @param clock - The clock the engine was created with, so `advanceTime` reaches its tokens.
 * @param basePath - The engine's JSON:API base path, whose writes `onWrite` hears of.
 * @returns The extended mock.
 */
export const extend = (drupal: Drupal, extensions: Extension[] = [], clock?: MockClock, basePath = '/jsonapi'): ExtendedDrupal => {
  const base = withoutTrailingSlashes(basePath) || '/jsonapi'
  const state = new Map<string, unknown>()
  const added: Layer[] = []
  const active: Layer[] = []
  let requests: RecordedRequest[] = []
  let sent: SentRequest[] = []
  const prefixes = Object.values(drupal.manifest.languages).filter(Boolean)
  const layers = (): Layer[] => [...added, ...active, ...[...extensions].reverse()]

  // Only a write the site's store took: an extension's own 2xx answer saved nothing.
  const notify = (method: string, route: string, path: string, answered: Answered): string[] => {
    const errors: string[] = []
    if (!['POST', 'PATCH', 'DELETE'].includes(method) || answered.status >= 300 || !route.startsWith(`${base}/`)) return errors
    const send = (url: string, init: RequestInit = {}): void => {
      const entry: SentRequest = { url, method: init.method || 'GET' }
      sent.push(entry)
      // Node 16 has no fetch, nor has Jest's jsdom environment. A test there reads this in `sent()`.
      if (typeof fetch !== 'function') {
        entry.error = 'This runtime has no fetch.'
        return
      }
      fetch(url, init).then((response) => { entry.status = response.status }, (error: Error) => { entry.error = error.message })
    }
    const data = (answered.body as { data?: Resource } | undefined)?.data
    for (const layer of layers()) {
      try {
        layer.onWrite?.({ method, path, ...(data ? { resource: data } : {}), state, send })
      } catch (error) {
        errors.push(`${layer.name || 'onWrite'}: ${(error as Error).message}`)
      }
    }
    return errors
  }

  const handle: Drupal['handle'] = (method, input, headers = {}, body) => {
    const url = new URL(input, 'http://drupal.invalid')
    const upper = method.toUpperCase()
    const path = withoutTrailingSlashes(url.pathname) || '/'
    const prefix = prefixes.find((candidate) => path === `/${candidate}` || path.startsWith(`/${candidate}/`))
    const route = prefix ? path.slice(prefix.length + 1) || '/' : path
    let json: unknown
    try {
      json = body ? JSON.parse(body) : undefined
    } catch {
      // A body that is not JSON is the handler's to read as text.
    }
    const request = (params: Record<string, string>): ExtensionRequest => ({ method: upper, url, path, route, ...(prefix ? { prefix } : {}), params, query: Object.fromEntries(url.searchParams), headers, ...(body !== undefined ? { body } : {}), ...(json !== undefined ? { json } : {}), state, drupal })
    const routed = (): Answered | undefined => {
      for (const layer of layers()) {
        for (const [pattern, handler] of Object.entries(layer.routes || {})) {
          const { method: wanted, match, names } = compile(pattern)
          const found = (wanted === 'ANY' || wanted === upper) && (route.match(match) || path.match(match))
          if (found) return settled(handler(request(Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1]!)])))), layer.name || pattern)
        }
      }
      return undefined
    }
    let fromStore = false
    const stock = (): Answered => {
      const own = routed()
      if (own) return own
      fromStore = true
      return drupal.handle(method, input, headers, body)
    }
    const chain = layers().reduceRight<() => Answered>((next, layer) => (layer.answer ? () => settled(layer.answer!(request({}), next), layer.name || 'answer') : next), stock)
    const answered = chain()
    const errors = fromStore ? notify(upper, route, path, answered) : []
    requests.push({ method: upper, path, search: url.search, headers, ...(body !== undefined ? { body } : {}), status: answered.status, ...(errors.length ? { errors } : {}) })
    return answered
  }

  const extended: ExtendedDrupal = {
    ...drupal,
    handle,
    // Over `handle`, so a client on `fetch` meets the extensions too.
    fetch: async (input, init) => {
      const given = new Request(input instanceof URL ? input.toString() : input, init)
      const headers: Record<string, string> = {}
      given.headers.forEach((value, name) => { headers[name] = value })
      const text = given.method === 'GET' || given.method === 'HEAD' ? undefined : await given.text()
      const { status, headers: answerHeaders, body } = handle(given.method, given.url, headers, text)
      const bodyText = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)
      return new Response(given.method === 'HEAD' || status === 204 || status === 304 ? null : bodyText, { status, headers: answerHeaders })
    },
    reset: () => {
      drupal.reset()
      state.clear()
      added.length = 0
      active.length = 0
      requests = []
      sent = []
      if (clock) clock.offset = 0
    },
    use: (extension) => {
      // The engine indexes its resources once, so a fixture added now would be missed by collections and includes.
      if (extension.fixtures) throw new Error(`The extension ${extension.name || ''} has fixtures, which use() cannot add: pass it to createMock or startMock instead.`.replace('  ', ' '))
      added.unshift(extension)
    },
    scenario: (name) => {
      const found = [...added, ...extensions].map((extension) => (extension as Extension).scenarios?.[name]).find(Boolean)
      if (!found) throw new Error(`No extension names a scenario "${name}".`)
      active.unshift({ name, ...found })
    },
    requests: () => [...requests],
    sent: () => [...sent],
    advanceTime: (seconds) => {
      if (!clock) throw new Error('This mock was created without a clock.')
      if (!Number.isFinite(seconds)) throw new Error(`advanceTime takes a number of seconds, not ${seconds}.`)
      clock.offset += seconds * 1000
    },
  }
  return extended
}

/** The time a mock reads, which a test can move on. */
export interface MockClock {
  offset: number
  now: () => number
}

/** A new clock, at the real time. */
export const createClock = (): MockClock => {
  const clock: MockClock = { offset: 0, now: () => Date.now() + clock.offset }
  return clock
}
