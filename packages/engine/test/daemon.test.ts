import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { pidFileFor, running, start, stop } from '../src/daemon'

const root = join(__dirname, '..', '..', '..')
// The built command, as a preset package runs it: the background server is a process of its own.
const cli = join(root, 'packages', 'engine', 'dist', 'cli.js')
const umami = join(root, 'presets', 'umami', 'dump')

const freePort = (): Promise<number> => new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  })
})

/** A pid file of the test's own, and a stop when the test finishes, so a failure leaves no server behind. */
const setUp = async () => {
  const port = await freePort()
  const pidFile = join(mkdtempSync(join(tmpdir(), 'ddm-daemon-')), 'mock.pid')
  onTestFinished(async () => {
    await stop(pidFile)
  })
  return { port, pidFile, host: '127.0.0.1', readyTimeout: 20 }
}

describe('the background server', () => {
  it('returns once /jsonapi answers, refuses a second start, and stops until the port is free', async () => {
    const { port, ...options } = await setUp()
    const { line, instance } = await start({ entry: [cli, 'serve', umami], args: ['--port', String(port)], port, ...options })
    expect(line).toBe(`umami from Drupal ${(JSON.parse(readFileSync(join(umami, 'manifest.json'), 'utf8')) as { drupal: { core: string } }).drupal.core}, listening on http://127.0.0.1:${port}`)
    // start has returned, so the next line of a script can use the server.
    expect((await fetch(`http://127.0.0.1:${port}/jsonapi`)).status).toBe(200)
    expect(await running(options.pidFile)).toEqual(instance)
    expect(instance).toMatchObject({ port, preset: 'umami', url: `http://127.0.0.1:${port}` })
    await expect(start({ entry: [cli, 'serve', umami], args: ['--port', String(port)], port, ...options })).rejects.toThrow(`already running on port ${port}, pid ${instance.pid}`)
    expect(await stop(options.pidFile)).toEqual(instance)
    expect(existsSync(options.pidFile)).toBe(false)
    await expect(fetch(`http://127.0.0.1:${port}/jsonapi`)).rejects.toThrow()
    // A second stop finds nothing, and says so rather than failing.
    expect(await stop(options.pidFile)).toBeUndefined()
  }, 30000)

  it('fails with the log when the server exits before it listens', async () => {
    const { port, ...options } = await setUp()
    await expect(start({ entry: ['-e', 'console.error("no preset here"); process.exit(3)'], args: [], port, ...options })).rejects.toThrow(/exited with status 3 before it listened\.\nno preset here/)
    expect(existsSync(options.pidFile)).toBe(false)
  })

  it('stops a server that does not listen in time, and fails with the log', async () => {
    const { port, ...options } = await setUp()
    const started = Date.now()
    await expect(start({ entry: ['-e', 'console.log("warming up"); setInterval(() => {}, 1000)'], args: [], port, ...options, readyTimeout: 0.5 })).rejects.toThrow(/did not listen within 0\.5 seconds\.\nwarming up/)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(existsSync(options.pidFile)).toBe(false)
  })

  it('forgets a pid file whose server has gone, or whose pid the system gave to something else', async () => {
    const { port, pidFile } = await setUp()
    writeFileSync(pidFile, 'not json')
    expect(await running(pidFile)).toBeUndefined()
    expect(existsSync(pidFile)).toBe(false)
    // This process is alive, but it holds no server on the port, so the pid is not the mock's.
    writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port, host: '127.0.0.1', log: '' }))
    expect(await running(pidFile)).toBeUndefined()
    expect(existsSync(pidFile)).toBe(false)
    expect(await running(pidFile)).toBeUndefined()
  })

  it('keeps one pid file per port in the temporary directory unless told otherwise', () => {
    expect(pidFileFor(8925)).toBe(join(tmpdir(), 'decoupled-drupal-mock-8925.pid'))
    expect(pidFileFor(8925, 'run/mock.pid')).toBe(join(process.cwd(), 'run', 'mock.pid'))
  })
})
