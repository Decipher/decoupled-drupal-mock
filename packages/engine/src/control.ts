import { request as httpRequest } from 'node:http'
import type { Token } from './identity.js'

/** The path under which a server started for tests takes its orders: on only when asked for, and never Drupal's own. */
export const CONTROL_PATH = '/__decoupled-drupal-mock'

/** The environment variable a test runner's setup leaves a server's URL in. */
export const URL_VARIABLE = 'DECOUPLED_DRUPAL_MOCK_URL'

/** A running server, from any process that can reach it. */
export interface MockClient {
  url: string
  /** Drops every write and every token, back to the preset as built. */
  reset: () => Promise<void>
  /** A token for a user of the preset, past the grant: a test's shortcut to a signed-in request. */
  tokenFor: (name: string, scopes?: string[]) => Promise<Token>
}

// node:http and not fetch: Node 16 has no fetch, and neither has Jest's jsdom environment on any Node.
const order = (url: string, path: string, body?: unknown): Promise<string> => new Promise((resolve, reject) => {
  const text = body === undefined ? '' : JSON.stringify(body)
  const request = httpRequest(`${url}${CONTROL_PATH}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } }, (response) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => chunks.push(chunk))
    response.on('end', () => {
      const answer = Buffer.concat(chunks).toString('utf8')
      if (response.statusCode && response.statusCode < 300) resolve(answer)
      else reject(new Error(response.statusCode === 404 ? `${url} takes no orders: start it with --control.` : answer))
    })
  })
  request.on('error', reject)
  request.end(text)
})

/**
 * A running server, for a test in another process than the one that started it.
 *
 * @param url - Its URL, or the one the runner's setup left in the environment.
 * @returns The client.
 */
export const connectMock = (url: string | undefined = process.env[URL_VARIABLE]): MockClient => {
  if (!url) throw new Error(`No server to connect to: name its URL, or set ${URL_VARIABLE}.`)
  return {
    url,
    reset: async () => { await order(url, 'reset') },
    tokenFor: async (name, scopes) => JSON.parse(await order(url, 'token', { name, ...(scopes ? { scopes } : {}) })) as Token,
  }
}
