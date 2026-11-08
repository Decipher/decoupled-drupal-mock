import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { daemonCommand, running, stop } from '../src/daemon'
import { presetCommand } from '../src/serve-command'

const root = join(__dirname, '..', '..', '..')
const cli = join(root, 'packages', 'engine', 'dist', 'cli.js')
const umami = join(root, 'presets', 'umami', 'dump')

/** What process.exit was called with, thrown so the command stops where the real one would. */
class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${code}`)
  }
}

const freePort = (): Promise<number> => new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  })
})

let printed: string[]
beforeEach(() => {
  printed = []
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Exit(code === null || code === undefined ? undefined : Number(code))
  })
  vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line))
  vi.spyOn(console, 'error').mockImplementation((line: string) => void printed.push(line))
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs a command and returns what it printed and the status it would have exited with. */
const run = async (command: () => Promise<void>): Promise<{ status: number, output: string }> => {
  try {
    await command()
    return { status: 0, output: printed.join('\n') }
  } catch (error) {
    if (error instanceof Exit) return { status: error.code ?? 0, output: printed.join('\n') }
    throw error
  }
}

const setUp = async () => {
  const port = String(await freePort())
  const pidFile = join(mkdtempSync(join(tmpdir(), 'ddm-command-')), 'mock.pid')
  onTestFinished(async () => {
    await stop(pidFile)
  })
  return { port, pidFile, options: ['--port', port, '--pid-file', pidFile] }
}

describe('the start, status and stop commands', () => {
  it('start, status and stop a server, and say so', async () => {
    const { port, options } = await setUp()
    expect(await run(() => daemonCommand('status', [], options))).toEqual({ status: 1, output: `No mock is running on port ${port}.` })
    printed = []
    const started = await run(() => daemonCommand('start', [cli, 'serve', umami], [...options, '--ready-timeout', '20']))
    expect(started).toMatchObject({ status: 0, output: expect.stringMatching(new RegExp(`^umami from Drupal .+, listening on http://127\\.0\\.0\\.1:${port}$`)) })
    printed = []
    expect(await run(() => daemonCommand('status', [], options))).toMatchObject({ status: 0, output: expect.stringMatching(new RegExp(`^umami is running on http://127\\.0\\.0\\.1:${port}, pid \\d+\\.$`)) })
    printed = []
    expect(await run(() => daemonCommand('start', [cli, 'serve', umami], options))).toMatchObject({ status: 1, output: expect.stringContaining(`already running on port ${port}`) })
    printed = []
    expect(await run(() => daemonCommand('stop', [], options))).toMatchObject({ status: 0, output: expect.stringMatching(new RegExp(`^Stopped the mock on port ${port}, pid \\d+\\.$`)) })
    printed = []
    expect(await run(() => daemonCommand('stop', [], options))).toEqual({ status: 0, output: `No mock is running on port ${port}.` })
  }, 30000)

  it('say a server that has not listened yet is starting', async () => {
    const { port, pidFile, options } = await setUp()
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    onTestFinished(() => {
      child.kill('SIGKILL')
    })
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, port: Number(port), host: '127.0.0.1', log: '' }))
    expect(await run(() => daemonCommand('status', [], options))).toEqual({ status: 0, output: `A mock is starting on port ${port}, pid ${child.pid}.` })
  })

  it('refuse options they cannot use, before anything runs', async () => {
    const { pidFile } = await setUp()
    const refusals: Array<[string[], string]> = [
      [['--port', 'none'], '--port must be a port from 1 to 65535, not none.'],
      [['--port', '70000'], '--port must be a port from 1 to 65535, not 70000.'],
      [['--ready-timeout', '0'], '--ready-timeout is a number of seconds, not 0.'],
      [['--ready-timeout', 'soon'], '--ready-timeout is a number of seconds, not soon.'],
      [['--pid-file'], '--pid-file names a file: --pid-file ./mock.pid'],
      [['--pid-file', '--port', '3005'], '--pid-file names a file: --pid-file ./mock.pid'],
    ]
    for (const [options, message] of refusals) {
      printed = []
      expect(await run(() => daemonCommand('start', [cli, 'serve', umami], options))).toEqual({ status: 1, output: message })
    }
    expect(existsSync(pidFile)).toBe(false)
  })

  it('report a start that fails, with its log', async () => {
    const { options } = await setUp()
    expect(await run(() => daemonCommand('start', ['-e', 'console.error("broken"); process.exit(2)', '--'], options))).toEqual({ status: 1, output: 'The mock exited with status 2 before it listened.\nbroken' })
  })

  it('leave a process alone whose pid the system gave to something else', async () => {
    const { port, pidFile } = await setUp()
    // Something else holds the port under the recorded pid, with a command line that is not the server's.
    const child = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${port}, '127.0.0.1', () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] })
    onTestFinished(() => {
      child.kill('SIGKILL')
    })
    await new Promise((done) => child.stdout.once('data', done))
    const record = { pid: child.pid, port: Number(port), host: '127.0.0.1', log: '', url: `http://127.0.0.1:${port}`, command: 'node packages/engine/dist/cli.js serve umami' }
    writeFileSync(pidFile, JSON.stringify(record))
    expect(await running(pidFile)).toBeUndefined()
    expect(await stop(pidFile)).toBeUndefined()
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()
    // With no command line recorded, as where ps cannot say, the pid and the port are all there is to go on.
    const { command: _, ...unrecorded } = record
    writeFileSync(pidFile, JSON.stringify(unrecorded))
    expect(await running(pidFile)).toEqual(unrecorded)
  })
})

describe('a preset package\'s command', () => {
  it('passes start, status and stop to the background server', async () => {
    const { port, options } = await setUp()
    expect(await run(() => presetCommand(umami, ['status', ...options], join(root, 'presets', 'umami', 'bin.js')))).toEqual({ status: 1, output: `No mock is running on port ${port}.` })
  })

  it('serves in the foreground with no command or with serve, and checks the options serve takes', async () => {
    for (const argv of [['--port', 'none'], ['serve', '--port', 'none']]) {
      printed = []
      expect(await run(() => presetCommand(umami, argv, join(root, 'presets', 'umami', 'bin.js')))).toEqual({ status: 1, output: '--port must be a port from 1 to 65535, not none.' })
    }
  })
})

describe('the engine\'s command', () => {
  const cliWith = async (...argv: string[]) => {
    const saved = process.argv
    process.argv = [process.execPath, cli, ...argv]
    try {
      vi.resetModules()
      return await run(async () => {
        await import('../src/cli')
      })
    } finally {
      process.argv = saved
    }
  }

  it('prints its usage for a command it does not know', async () => {
    expect(await cliWith('restart')).toMatchObject({ status: 1, output: expect.stringMatching(/^Usage: decoupled-drupal-mock serve <preset> .+\n {7}decoupled-drupal-mock start <preset> /) })
    printed = []
    // start needs a preset, where status and stop take none.
    expect(await cliWith('start', '--port', '3005')).toMatchObject({ status: 1, output: expect.stringMatching(/^Usage: /) })
  })

  it('passes each command on with its options', async () => {
    const { port, options } = await setUp()
    expect(await cliWith('status', ...options)).toEqual({ status: 1, output: `No mock is running on port ${port}.` })
    printed = []
    expect(await cliWith('stop', ...options)).toEqual({ status: 0, output: `No mock is running on port ${port}.` })
    printed = []
    expect(await cliWith('start', 'umami', ...options, '--ready-timeout', 'soon')).toEqual({ status: 1, output: '--ready-timeout is a number of seconds, not soon.' })
    printed = []
    expect(await cliWith('serve', 'umami', '--port', 'none')).toEqual({ status: 1, output: '--port must be a port from 1 to 65535, not none.' })
  })
})
