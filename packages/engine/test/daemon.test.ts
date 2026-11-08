import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
    // This process is alive, but the server that listened has left the port, so the pid is no longer the mock's.
    writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port, host: '127.0.0.1', log: '', url: `http://127.0.0.1:${port}` }))
    expect(await running(pidFile)).toBeUndefined()
    expect(existsSync(pidFile)).toBe(false)
    expect(await running(pidFile)).toBeUndefined()
  })

  it('waits past the listening line until /jsonapi answers, and stops a server that never does', async () => {
    const { port, ...options } = await setUp()
    const says = `console.log("umami from Drupal 11, listening on http://127.0.0.1:${port}"); setInterval(() => {}, 1000)`
    await expect(start({ entry: ['-e', says], args: [], port, ...options, readyTimeout: 0.5 })).rejects.toThrow(/did not answer within 0\.5 seconds\.\numami from Drupal 11/)
    expect(existsSync(options.pidFile)).toBe(false)
  })

  it('keeps a server that has not listened yet, so it can be stopped, and refuses a second start meanwhile', async () => {
    const { port, ...options } = await setUp()
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const gone = new Promise((done) => child.on('exit', done))
    const record = { pid: child.pid!, port, host: '127.0.0.1', log: '' }
    writeFileSync(options.pidFile, JSON.stringify(record))
    expect(await running(options.pidFile)).toEqual(record)
    await expect(start({ entry: [cli, 'serve', umami], args: ['--port', String(port)], port, ...options })).rejects.toThrow(`already running on port ${port}, pid ${child.pid}`)
    expect(await stop(options.pidFile)).toEqual(record)
    await gone
    expect(existsSync(options.pidFile)).toBe(false)
  })

  it('never signals a pid a pid file could not have been given by start', async () => {
    const { pidFile } = await setUp()
    // 0 and -1 would signal this process group and every process the user owns.
    for (const pid of [0, -1, 1.5, '42', null]) {
      writeFileSync(pidFile, JSON.stringify({ pid, port: 8925, host: '127.0.0.1', log: '' }))
      expect(await stop(pidFile)).toBeUndefined()
      expect(existsSync(pidFile)).toBe(false)
    }
    writeFileSync(pidFile, 'null')
    expect(await running(pidFile)).toBeUndefined()
  })

  it('keeps one pid file per port in a directory of the user\'s own unless told otherwise', () => {
    const pidFile = pidFileFor(8925)
    expect(pidFile.startsWith(tmpdir())).toBe(true)
    expect(pidFile.endsWith('8925.pid')).toBe(true)
    // Nobody else can leave a link where the pid file and the log go.
    expect(statSync(join(pidFile, '..')).mode & 0o077).toBe(0)
    expect(pidFileFor(8925, 'run/mock.pid')).toBe(join(process.cwd(), 'run', 'mock.pid'))
  })
})

describe('the background server when things go wrong', () => {
  it('lets one of two starts at once run a server, and tells the other', async () => {
    const { port, ...options } = await setUp()
    const both = await Promise.allSettled([1, 2].map(() => start({ entry: [cli, 'serve', umami], args: ['--port', String(port)], port, ...options })))
    expect(both.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect((both.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(new RegExp(`already (starting|running) on port ${port}`))
  }, 30000)

  it('fails with the log when the server exits after it listens and before it answers', async () => {
    const { port, ...options } = await setUp()
    const says = `console.log("umami from Drupal 11, listening on http://127.0.0.1:${port}"); setTimeout(() => process.exit(4), 200)`
    await expect(start({ entry: ['-e', says], args: [], port, ...options })).rejects.toThrow(/exited with status 4\.\numami from Drupal 11/)
  })

  it('gives up its claim on the pid file when the log cannot be written', async () => {
    const { port, ...options } = await setUp()
    mkdirSync(options.pidFile.replace(/\.pid$/, '.log'))
    await expect(start({ entry: [cli, 'serve', umami], args: [], port, ...options })).rejects.toThrow(/EISDIR/)
    expect(existsSync(options.pidFile)).toBe(false)
  })

  it('kills a server that ignores SIGTERM, and forgets one that has already gone', async () => {
    const { port, pidFile } = await setUp()
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("up"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] })
    await new Promise((done) => child.stdout.once('data', done))
    const gone = new Promise((done) => child.on('exit', (_code, signal) => done(signal)))
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, host: '127.0.0.1', log: '' }))
    expect(await stop(pidFile)).toMatchObject({ pid: child.pid })
    expect(await gone).toBe('SIGKILL')
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, host: '127.0.0.1', log: '' }))
    expect(await running(pidFile)).toBeUndefined()
  }, 15000)

  it('says so when the port is still held after the server has gone', async () => {
    const { port, pidFile } = await setUp()
    const holder = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${port}, '127.0.0.1', () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] })
    onTestFinished(() => {
      holder.kill('SIGKILL')
    })
    await new Promise((done) => holder.stdout.once('data', done))
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, host: '127.0.0.1', log: '' }))
    await expect(stop(pidFile)).rejects.toThrow(`Port ${port} is still in use after stopping pid ${child.pid}.`)
  }, 15000)

  it('refuses a directory for the pid file that someone else could write to', () => {
    const saved = process.env.TMPDIR
    const shared = mkdtempSync(join(tmpdir(), 'ddm-shared-'))
    mkdirSync(join(shared, `decoupled-drupal-mock-${process.getuid?.() ?? 'user'}`), { mode: 0o777 })
    process.env.TMPDIR = shared
    try {
      expect(() => pidFileFor(8925)).toThrow('is not a directory that only you can write to')
    } finally {
      if (saved === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = saved
    }
  })
})
