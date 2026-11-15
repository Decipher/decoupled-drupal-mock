import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { identityOf, pidFileFor, running, start, stop } from '../src/daemon'

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
  it('returns once the server answers, refuses a second start, and stops until the port is free', async () => {
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
    // This process is alive, but it started at another time than the server did, so the pid is no longer the mock's.
    const reused = { pid: process.pid, port, host: '127.0.0.1', log: '', identity: 'Thu Jan  1 00:00:00 1970 node' }
    for (const record of [reused, { ...reused, url: `http://127.0.0.1:${port}` }]) {
      writeFileSync(pidFile, JSON.stringify(record))
      expect(await running(pidFile)).toBeUndefined()
      expect(existsSync(pidFile)).toBe(false)
      writeFileSync(pidFile, JSON.stringify(record))
      expect(await stop(pidFile)).toBeUndefined()
    }
    // A record with nothing to tell the pid's process by is never trusted with a signal.
    const { identity: _, ...unidentified } = reused
    writeFileSync(pidFile, JSON.stringify(unidentified))
    expect(await stop(pidFile)).toBeUndefined()
    expect(existsSync(pidFile)).toBe(false)
  })

  it('waits past the listening line until the server answers, and stops a server that never does', async () => {
    const { port, ...options } = await setUp()
    const says = `console.log("umami from Drupal 11, listening on http://127.0.0.1:${port}"); setInterval(() => {}, 1000)`
    await expect(start({ entry: ['-e', says], args: [], port, ...options, readyTimeout: 0.5 })).rejects.toThrow(/did not answer within 0\.5 seconds\.\numami from Drupal 11/)
    expect(existsSync(options.pidFile)).toBe(false)
  })

  it('keeps a server that has not listened yet, so it can be stopped, and refuses a second start meanwhile', async () => {
    const { port, ...options } = await setUp()
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const gone = new Promise((done) => child.on('exit', done))
    const record = { pid: child.pid!, port, host: '127.0.0.1', log: '', identity: identityOf(child.pid!)! }
    writeFileSync(options.pidFile, JSON.stringify(record))
    expect(await running(options.pidFile)).toEqual(record)
    await expect(start({ entry: [cli, 'serve', umami], args: ['--port', String(port)], port, ...options })).rejects.toThrow(`already running on port ${port}, pid ${child.pid}`)
    expect(await stop(options.pidFile)).toEqual(record)
    await gone
    expect(existsSync(options.pidFile)).toBe(false)
  })

  it('knows a server whatever time zone start, status and stop run in', async () => {
    const { port, pidFile } = await setUp()
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    onTestFinished(() => {
      child.kill('SIGKILL')
    })
    const saved = process.env.TZ
    try {
      process.env.TZ = 'Australia/Sydney'
      const record = { pid: child.pid!, port, host: '127.0.0.1', log: '', identity: identityOf(child.pid!)! }
      writeFileSync(pidFile, JSON.stringify(record))
      process.env.TZ = 'America/New_York'
      expect(await running(pidFile)).toEqual(record)
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })

  it('still knows a server that changes the command line ps shows for it', async () => {
    const { port, pidFile } = await setUp()
    const child = spawn(process.execPath, ['-e', 'process.stdin.once("data", () => { process.title = "renamed"; console.log("up") }); setInterval(() => {}, 1000)'], { stdio: ['pipe', 'pipe', 'ignore'] })
    const record = { pid: child.pid!, port, host: '127.0.0.1', log: '', identity: identityOf(child.pid!)! }
    writeFileSync(pidFile, JSON.stringify(record))
    child.stdin.write('rename\n')
    await new Promise((done) => child.stdout.once('data', done))
    expect(execFileSync('ps', ['-o', 'args=', '-p', String(child.pid)], { encoding: 'utf8' }).trim()).toBe('renamed')
    expect(await running(pidFile)).toEqual(record)
    expect(await stop(pidFile)).toEqual(record)
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
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, host: '127.0.0.1', log: '', identity: identityOf(child.pid!) }))
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
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, host: '127.0.0.1', log: '', identity: identityOf(child.pid!) }))
    await expect(stop(pidFile)).rejects.toThrow(`Port ${port} is still in use after stopping pid ${child.pid}.`)
  }, 15000)

  it('leaves a process alone, and keeps its record, when ps cannot say what the process is', async () => {
    const { port, pidFile } = await setUp()
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    onTestFinished(() => {
      child.kill('SIGKILL')
    })
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, host: '127.0.0.1', log: '', identity: identityOf(child.pid!) }))
    const saved = process.env.PATH
    process.env.PATH = mkdtempSync(join(tmpdir(), 'ddm-no-ps-'))
    try {
      await expect(running(pidFile)).rejects.toThrow(`ps cannot say whether pid ${child.pid} is still the mock`)
      await expect(stop(pidFile)).rejects.toThrow('ps cannot say')
      await expect(start({ entry: [cli, 'serve', umami], args: [], port, pidFile, host: '127.0.0.1', readyTimeout: 1 })).rejects.toThrow('ps cannot say')
    } finally {
      process.env.PATH = saved
    }
    expect(existsSync(pidFile)).toBe(true)
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()
  })

  it('sends no SIGKILL, and keeps the record, when ps stops answering while a server ignores SIGTERM', async () => {
    const { port, pidFile } = await setUp()
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("up"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] })
    onTestFinished(() => {
      rmSync(pidFile, { force: true })
      child.kill('SIGKILL')
    })
    await new Promise((done) => child.stdout.once('data', done))
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port, host: '127.0.0.1', log: '', identity: identityOf(child.pid!) }))
    // stop checks the pid and sends SIGTERM before its first wait, so ps goes away only after that.
    const stopping = stop(pidFile)
    const saved = process.env.PATH
    process.env.PATH = mkdtempSync(join(tmpdir(), 'ddm-no-ps-'))
    try {
      await expect(stopping).rejects.toThrow(`ps cannot say whether pid ${child.pid} is still the mock, so it was sent SIGTERM and not SIGKILL.`)
    } finally {
      process.env.PATH = saved
    }
    expect(child.signalCode).toBeNull()
    expect(existsSync(pidFile)).toBe(true)
  }, 15000)

  it('ends the server it started, and gives up the record, when a stop signals start before it returns', async () => {
    const daemon = join(root, 'packages', 'engine', 'dist', 'daemon.js')
    for (const wait of ['claim', 'server']) {
      const { port, pidFile } = await setUp()
      const marker = join(pidFile, '..', 'server.pid')
      // A server that records its pid and never listens, so start is still waiting when stop comes.
      const server = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`
      const script = `const { start } = await import(${JSON.stringify(daemon)}); await start({ entry: ['-e', ${JSON.stringify(server)}], args: [], port: ${port}, host: '127.0.0.1', pidFile: ${JSON.stringify(pidFile)}, readyTimeout: 60 })`
      const launcher = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore' })
      const ended = new Promise((done) => launcher.on('exit', (_code, signal) => done(signal)))
      // Once the claim is there, or once the server has written its pid.
      const ready = wait === 'claim' ? pidFile : marker
      while (!existsSync(ready)) await new Promise((done) => setTimeout(done, 5))
      const stopped = await stop(pidFile)
      // stop finds the claim, which names start, or the server's own record if start had already written it.
      expect(stopped).toBeDefined()
      const signalled = stopped!.pid === launcher.pid
      expect(await ended).toBe(signalled ? 'SIGTERM' : null)
      expect(existsSync(pidFile)).toBe(false)
      // Whichever was signalled, no server is left running.
      const servers = [...(signalled ? [] : [stopped!.pid]), ...(existsSync(marker) ? [Number(readFileSync(marker, 'utf8'))] : [])]
      await new Promise((done) => setTimeout(done, 200))
      for (const pid of servers) expect(() => process.kill(pid, 0)).toThrow()
    }
  }, 30000)

  it('takes any answer as ready, whatever path the site serves JSON:API at', async () => {
    const { port, ...options } = await setUp()
    // A server with no /jsonapi, as a site with another jsonapi.base_path has.
    const server = `require('node:http').createServer((_, response) => { response.statusCode = 404; response.end() }).listen(${port}, '127.0.0.1', () => console.log('umami from Drupal 11, listening on http://127.0.0.1:${port}'))`
    const { instance } = await start({ entry: ['-e', server], args: [], port, ...options })
    expect(instance.url).toBe(`http://127.0.0.1:${port}`)
    expect(await stop(options.pidFile)).toEqual(instance)
  })

  it('keeps a record another start claimed while a stale one was being cleared', async () => {
    const { port, pidFile } = await setUp()
    const daemon = join(root, 'packages', 'engine', 'dist', 'daemon.js')
    const stale = JSON.stringify({ pid: 2 ** 22 + 1, port, host: '127.0.0.1', log: '', identity: 'gone' })
    writeFileSync(pidFile, stale)
    // Held here, so the other process reads the stale record and then waits to clear it.
    const lock = `${pidFile}.lock`
    mkdirSync(lock)
    const clearing = spawn(process.execPath, ['--input-type=module', '-e', `const { running } = await import(${JSON.stringify(daemon)}); await running(${JSON.stringify(pidFile)})`], { stdio: 'ignore' })
    const cleared = new Promise((done) => clearing.on('exit', done))
    await new Promise((done) => setTimeout(done, 500))
    // The other process waits for the lock rather than clearing the record at once.
    expect(readFileSync(pidFile, 'utf8')).toBe(stale)
    // Meanwhile another start has cleared it and claimed the file.
    const claimed = JSON.stringify({ pid: process.pid, port, host: '127.0.0.1', log: '', identity: identityOf(process.pid), launcher: true })
    writeFileSync(pidFile, claimed)
    rmSync(lock, { recursive: true })
    expect(await cleared).toBe(0)
    expect(readFileSync(pidFile, 'utf8')).toBe(claimed)
    rmSync(pidFile)
  })

  it('takes over a lock left by a process that died holding it', async () => {
    const { pidFile } = await setUp()
    writeFileSync(pidFile, JSON.stringify({ pid: 2 ** 22 + 1, port: 1, host: '127.0.0.1', log: '', identity: 'gone' }))
    const lock = `${pidFile}.lock`
    mkdirSync(lock)
    const then = new Date(Date.now() - 10000)
    utimesSync(lock, then, then)
    const started = Date.now()
    expect(await running(pidFile)).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(2000)
    expect(existsSync(pidFile)).toBe(false)
    expect(existsSync(lock)).toBe(false)
  })

  it('never sends SIGKILL to a start that is slow to hand over, so its server does not outlive it', async () => {
    const { port, pidFile } = await setUp()
    const daemon = join(root, 'packages', 'engine', 'dist', 'daemon.js')
    const dir = join(pidFile, '..')
    const marker = join(dir, 'server.pid')
    const asked = join(dir, 'asked')
    const release = join(dir, 'release')
    // A ps that, asked about any process but its caller, says so and holds until the test lets it go. start asks it
    // about the server it spawned, before it writes the server's record.
    const bin = mkdtempSync(join(tmpdir(), 'ddm-slow-ps-'))
    const ps = execFileSync('sh', ['-c', 'command -v ps'], { encoding: 'utf8' }).trim()
    writeFileSync(join(bin, 'ps'), '#!/bin/sh\nfor a; do last=$a; done\nif [ "$last" != "$PPID" ]; then\n  : > "$DDM_ASKED"\n  while [ ! -e "$DDM_RELEASE" ]; do sleep 0.05; done\nfi\nexec "$DDM_PS" "$@"\n', { mode: 0o755 })
    const server = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`
    const script = `const { start } = await import(${JSON.stringify(daemon)}); await start({ entry: ['-e', ${JSON.stringify(server)}], args: [], port: ${port}, host: '127.0.0.1', pidFile: ${JSON.stringify(pidFile)}, readyTimeout: 60 })`
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DDM_ASKED: asked, DDM_RELEASE: release, DDM_PS: ps }
    const launcher = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'ignore', env })
    const ended = new Promise((done) => launcher.on('exit', (_code, signal) => done(signal)))
    // If an assertion fails, the lookup is let go and nothing the test started is left running.
    onTestFinished(() => {
      writeFileSync(release, '')
      launcher.kill('SIGKILL')
      if (existsSync(marker)) {
        try {
          process.kill(Number(readFileSync(marker, 'utf8')), 'SIGKILL')
        } catch {
          // Already gone.
        }
      }
    })
    // start is held in the lookup, and the server it spawned is running, with only start's claim on record.
    while (!existsSync(asked) || !existsSync(marker)) await new Promise((done) => setTimeout(done, 5))
    const spawned = Number(readFileSync(marker, 'utf8'))
    expect(JSON.parse(readFileSync(pidFile, 'utf8'))).toMatchObject({ pid: launcher.pid, launcher: true })
    const stopping = stop(pidFile)
    // Past the five seconds after which stop sends a server SIGKILL.
    await new Promise((done) => setTimeout(done, 6000))
    expect(launcher.exitCode).toBeNull()
    expect(launcher.signalCode).toBeNull()
    writeFileSync(release, '')
    expect(await stopping).toMatchObject({ pid: launcher.pid, launcher: true })
    expect(await ended).toBe('SIGTERM')
    expect(existsSync(pidFile)).toBe(false)
    await new Promise((done) => setTimeout(done, 200))
    expect(() => process.kill(spawned, 0)).toThrow()
  }, 30000)

  it('refuses a pid file or a log that is a link or a pipe, and leaves what it points to alone', async () => {
    const { port, ...options } = await setUp()
    const dir = join(options.pidFile, '..')
    const target = join(dir, 'someone-elses')
    writeFileSync(target, JSON.stringify({ pid: process.pid, port, host: '127.0.0.1', log: '', identity: identityOf(process.pid) }))
    symlinkSync(target, options.pidFile)
    await expect(stop(options.pidFile)).rejects.toThrow('is not a file of your own')
    await expect(start({ entry: [cli, 'serve', umami], args: [], port, ...options })).rejects.toThrow('is not a file of your own')
    rmSync(options.pidFile)
    const pidFile = join(dir, 'other.pid')
    const log = join(dir, 'other.log')
    writeFileSync(target, 'keep')
    const fifo = (_target: string, path: string): void => {
      execFileSync('mkfifo', [path])
    }
    // A pipe with no reader would hold a blocking open for ever.
    for (const link of [symlinkSync, linkSync, fifo]) {
      link(target, log)
      await expect(start({ entry: [cli, 'serve', umami], args: [], port, ...options, pidFile })).rejects.toThrow(`${log} is not a file of your own`)
      expect(readFileSync(target, 'utf8')).toBe('keep')
      expect(existsSync(pidFile)).toBe(false)
      rmSync(log)
    }
  })

  it('lets one of several start commands at once run a server, each its own process, and keeps its record', async () => {
    const { port, pidFile } = await setUp()
    const starts = await Promise.all(Array.from({ length: 4 }, () => new Promise<{ status: number | null, output: string }>((done) => {
      const child = spawn(process.execPath, [cli, 'start', umami, '--port', String(port), '--pid-file', pidFile, '--ready-timeout', '20'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', (data: Buffer) => (output += data))
      child.stderr.on('data', (data: Buffer) => (output += data))
      child.on('exit', (status) => done({ status, output }))
    })))
    expect(starts.filter(({ status }) => status === 0)).toHaveLength(1)
    for (const { output } of starts.filter(({ status }) => status !== 0)) expect(output).toMatch(new RegExp(`already (starting|running) on port ${port}`))
    const instance = await running(pidFile)
    expect(instance).toMatchObject({ port, url: `http://127.0.0.1:${port}` })
    expect((await fetch(`http://127.0.0.1:${port}/jsonapi`)).status).toBe(200)
    expect(await stop(pidFile)).toEqual(instance)
  }, 60000)

  it('refuses a directory for the pid file that someone else could write to', () => {
    const saved = process.env.TMPDIR
    const shared = mkdtempSync(join(tmpdir(), 'ddm-shared-'))
    const own = join(shared, `decoupled-drupal-mock-${process.getuid?.() ?? 'user'}`)
    mkdirSync(own)
    // Set after creation, so the umask cannot take the write bits away.
    chmodSync(own, 0o777)
    process.env.TMPDIR = shared
    try {
      expect(() => pidFileFor(8925)).toThrow('is not a directory that only you can write to')
    } finally {
      if (saved === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = saved
    }
  })
})
