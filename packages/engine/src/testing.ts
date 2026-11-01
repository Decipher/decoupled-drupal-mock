import { createServer } from 'node:net'
import { connectMock } from './control.js'
import type { MockClient } from './control.js'
import { createDrupal as createCore } from './engine.js'
import type { Drupal } from './engine.js'
import { loadDump } from './load.js'
import { presetDir } from './preset.js'
import { listen } from './serve.js'

export { connectMock, URL_VARIABLE } from './control.js'
export type { MockClient } from './control.js'

/** A server in this process, with the engine behind it in reach. */
export interface Mock extends MockClient {
  drupal: Drupal
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
 * @returns The running server.
 */
export const startMock = async (preset: string): Promise<Mock> => {
  const dir = presetDir(preset)
  const dump = loadDump(dir)
  for (let attempt = 0; ; attempt++) {
    const port = await freePort()
    const url = `http://127.0.0.1:${port}`
    const drupal = createCore(dump, { baseUrl: url })
    try {
      const { close } = await listen(drupal, port, '127.0.0.1', { files: dir, control: true })
      return { ...connectMock(url), reset: async () => drupal.reset(), tokenFor: async (name, scopes) => drupal.tokenFor(name, scopes), drupal, close }
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
 * @returns The extended `test`.
 */
export const withDrupal = <Test>(test: Extendable<Test>, preset: string): Test => test.extend({
  // Playwright reads a fixture's dependencies from this pattern, so it must be written as one even when it is empty.
  // eslint-disable-next-line no-empty-pattern
  drupalServer: [async ({}, use: (mock: MockClient) => Promise<void>) => {
    if (process.env.DECOUPLED_DRUPAL_MOCK_URL) return use(connectMock())
    const mock = await startMock(preset)
    await use(mock)
    await mock.close()
  }, { scope: 'worker' }],
  drupal: async ({ drupalServer }: { drupalServer: MockClient }, use: (mock: MockClient) => Promise<void>) => {
    await use(drupalServer)
    await drupalServer.reset()
  },
})
