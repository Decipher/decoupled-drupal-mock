import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { connectMock, URL_VARIABLE } from './control.js'
import type { MockClient } from './control.js'
import type { DrupalOptions } from './engine.js'
import type { ExtendedDrupal, Extension } from './extend.js'
import { createMock } from './mock.js'
import { loadDump, loadOverlay } from './load.js'
import { presetDir } from './preset.js'

export { answerAxios, axiosAdapter, axiosVerbs } from './axios.js'
export { connectMock, URL_VARIABLE } from './control.js'
export type { MockClient } from './control.js'
export { createDrupal } from './engine.js'
export { createMock } from './mock.js'
export { loadDump, loadOverlay } from './load.js'
export { presetDir } from './preset.js'

/**
 * The engine over a preset, in this process: synchronous, and no port to manage. Reading the dump is the slow part, so
 * a suite does it once and calls `reset()` between tests.
 *
 * @param preset - A directory, a preset package or its short name.
 * @param options - The base URL the links name, the identities, the extensions and the recorded overlays by name.
 * @returns The engine.
 */
export const loadPreset = (preset: string, options: DrupalOptions & { extensions?: Extension[], overlays?: string[] } = {}): ExtendedDrupal => {
  const { overlays = [], extensions = [], ...rest } = options
  const dir = presetDir(preset)
  return createMock(loadDump(dir), { ...rest, extensions: [...overlays.map((name) => loadOverlay(dir, name)), ...extensions] })
}

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.on('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address()
    probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
  })
})

// A probe that gives up after a second, so a port held by something that never answers cannot stall the wait.
const answers = (url: string): Promise<boolean> => new Promise((resolve) => {
  const request = get(`${url}/jsonapi`, { timeout: 1000 }, (response) => {
    response.resume()
    resolve(true)
  })
  request.on('timeout', () => request.destroy())
  request.on('error', () => resolve(false))
})

/** A server in a process of its own, for a runner whose tests and browser live elsewhere. */
export interface SpawnedMock extends MockClient {
  /** Stops it. */
  close: () => Promise<void>
}

/**
 * Starts the CLI's server in a child process, with its test controls on, and waits until it answers.
 *
 * @param preset - A directory, a preset package or its short name.
 * @param options - The port, or a free one when not named, and the files that hold extensions.
 * @returns The running server.
 */
export const spawnMock = async (preset: string, options: { port?: number, extensions?: string[], overlays?: string[] } = {}): Promise<SpawnedMock> => {
  const port = options.port || await freePort()
  const url = `http://127.0.0.1:${port}`
  const child: ChildProcess = spawn(process.execPath, [join(__dirname, 'cli.js'), 'serve', preset, '--port', String(port), '--control', ...(options.extensions || []).flatMap((file) => ['--extension', file]), ...(options.overlays || []).flatMap((name) => ['--overlay', name])], { stdio: ['ignore', 'ignore', 'pipe'] })
  let errors = ''
  child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString('utf8') })
  let exited = false
  child.on('exit', () => { exited = true })
  for (let attempt = 0; attempt < 300 && !exited; attempt++) {
    if (await answers(url)) {
      return {
        ...connectMock(url),
        close: () => new Promise((resolve) => {
          // A server that has already gone has no exit left to wait for.
          if (exited) return resolve()
          child.on('exit', () => resolve())
          child.kill()
        }),
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill()
  throw new Error(`The mock did not start. ${errors}`)
}

let running: SpawnedMock | undefined

/**
 * A Jest `globalSetup`: a server for the whole run, its URL left in the environment for the tests and the workers.
 * `module.exports = globalSetup('umami')` in the file Jest is pointed at.
 *
 * @param preset - A directory, a preset package or its short name.
 * @param options - The files that hold extensions.
 * @returns The function Jest calls.
 */
export const globalSetup = (preset: string, options: { extensions?: string[], overlays?: string[] } = {}) => async (): Promise<void> => {
  running = await spawnMock(preset, options)
  process.env[URL_VARIABLE] = running.url
}

/** A Jest `globalTeardown`: stops what `globalSetup` started. */
export const globalTeardown = async (): Promise<void> => {
  await running?.close()
  running = undefined
}

/**
 * Cypress tasks over a running server: `drupal:reset`, `drupal:token`, `drupal:scenario`, `drupal:requests`, `drupal:sent` and `drupal:time`. In `setupNodeEvents`,
 * `on('task', cypressTasks(url))`.
 *
 * @param url - The server's URL, started with `--control`.
 * @returns The tasks.
 */
export const cypressTasks = (url?: string) => {
  const mock = connectMock(url)
  return {
    // Cypress tasks must answer something other than undefined.
    'drupal:reset': async () => { await mock.reset(); return null },
    'drupal:token': ({ name, scopes }: { name: string, scopes?: string[] }) => mock.tokenFor(name, scopes),
    'drupal:scenario': async (name: string) => { await mock.scenario(name); return null },
    'drupal:requests': () => mock.requests(),
    'drupal:sent': () => mock.sent(),
    'drupal:time': async (seconds: number) => { await mock.advanceTime(seconds); return null },
  }
}
