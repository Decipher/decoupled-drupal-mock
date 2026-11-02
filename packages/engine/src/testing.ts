import { createServer } from 'node:net'
import { connectMock } from './control.js'
import type { MockClient } from './control.js'
import type { ExtendedDrupal, Extension } from './extend.js'
import { createMock } from './mock.js'
import { loadDump, loadOverlay } from './load.js'
import { presetDir } from './preset.js'
import { listen } from './serve.js'

export { comparable } from './comparable.js'
export { connectMock, URL_VARIABLE } from './control.js'
export type { MockClient } from './control.js'

/** A server in this process, with the engine behind it in reach. */
export interface Mock extends MockClient {
  drupal: ExtendedDrupal
  /** Stops it. */
  close: () => Promise<void>
}

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.on('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
  })
})

/**
 * A server over a preset in this process, on a free port, for a runner that can import ESM: Vitest, Playwright, or
 * Jest with its ESM support on.
 *
 * @param preset - A directory, a preset package or its short name.
 * @param options - The extensions, and the recorded overlays: paths to overlay files.
 * @returns The running server.
 */
export const startMock = async (preset: string, options: { extensions?: Extension[], overlays?: string[] } = {}): Promise<Mock> => {
  const dir = presetDir(preset)
  const dump = loadDump(dir)
  const extensions = [...(options.overlays || []).map((name) => loadOverlay(dir, name)), ...(options.extensions || [])]
  for (let attempt = 0; ; attempt++) {
    const port = await freePort()
    const url = `http://127.0.0.1:${port}`
    const drupal = createMock(dump, { baseUrl: url, extensions })
    try {
      const { close } = await listen(drupal, port, '127.0.0.1', { files: dir, control: true })
      return { ...connectMock(url), reset: async () => drupal.reset(), tokenFor: async (name, scopes) => drupal.tokenFor(name, scopes), scenario: async (name) => drupal.scenario(name), requests: async () => drupal.requests(), sent: async () => drupal.sent(), advanceTime: async (seconds) => drupal.advanceTime(seconds), drupal, close }
    } catch (error) {
      // Another process can take the port between finding it free and binding it.
      if (attempt === 4) throw error
    }
  }
}

/** The part of a Playwright `test` this needs, so Playwright stays what a consumer brings. */
interface Extendable<Test> {
  extend: (fixtures: Record<string, unknown>) => Test
}

/**
 * A Playwright `test` with a `drupal` fixture: a server per worker, or the one at `DECOUPLED_DRUPAL_MOCK_URL` when a
 * frontend already points at it, reset after every test. A shared server takes one worker at a time, or its tests'
 * writes meet.
 *
 * @param test - Playwright's `test`.
 * @param preset - A directory, a preset package or its short name.
 * @param options - The extensions.
 * @returns The extended `test`.
 */
export const withDrupal = <Test>(test: Extendable<Test>, preset: string, options: { extensions?: Extension[], overlays?: string[] } = {}): Test => test.extend({
  // Playwright reads a fixture's dependencies from this pattern, so it must be written as one even when it is empty.
  // eslint-disable-next-line no-empty-pattern
  drupalServer: [async ({}, use: (mock: MockClient) => Promise<void>) => {
    if (process.env.DECOUPLED_DRUPAL_MOCK_URL) {
      // That server has the extensions and overlays it was started with, which may or may not be these.
      if (options.extensions?.length || options.overlays?.length) console.warn(`withDrupal is using the server at ${process.env.DECOUPLED_DRUPAL_MOCK_URL}, so the extensions and overlays passed here are not loaded: start that server with them.`)
      return use(connectMock())
    }
    const mock = await startMock(preset, options)
    await use(mock)
    await mock.close()
  }, { scope: 'worker' }],
  drupal: async ({ drupalServer }: { drupalServer: MockClient }, use: (mock: MockClient) => Promise<void>) => {
    await use(drupalServer)
    await drupalServer.reset()
  },
})
