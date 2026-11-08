import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The commands that run the server in the background, beside the foreground `serve`. */
export const daemonCommands = ['start', 'status', 'stop'] as const
export type DaemonCommand = typeof daemonCommands[number]

/** The options `start`, `status` and `stop` take, beside the ones `serve` takes. */
export const daemonOptions = '[--pid-file <file>] [--ready-timeout 30]'

/** What the pid file records of a server in the background. */
export interface Instance {
  pid: number
  port: number
  host: string
  /** The log the server writes to, which `start` prints when the server does not start. */
  log: string
  /** Set once the server listens. */
  url?: string
  /** Set once the server listens. */
  preset?: string
}

/**
 * The pid file for a port, in the system's temporary directory unless one is named.
 *
 * @param port - The port the server listens on.
 * @param pidFile - The file to use instead.
 */
export const pidFileFor = (port: number, pidFile?: string): string => pidFile ? resolve(pidFile) : join(tmpdir(), `decoupled-drupal-mock-${port}.pid`)

const logFileFor = (pidFile: string): string => `${pidFile.replace(/\.pid$/, '')}.log`

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Whether a process exists. EPERM means it does, and belongs to someone else. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Whether something holds the port, found by trying to bind it. */
const taken = (port: number, host: string): Promise<boolean> => new Promise((done) => {
  const probe = createServer()
  probe.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'EADDRINUSE'))
  probe.listen(port, host, () => probe.close(() => done(false)))
})

/** One GET, resolved with the status, or undefined when nothing answers. */
const answers = (url: string): Promise<number | undefined> => new Promise((done) => {
  const asking = request(url, (response) => {
    response.resume()
    done(response.statusCode)
  })
  asking.setTimeout(2000, () => asking.destroy())
  asking.on('error', () => done(undefined))
  asking.end()
})

/**
 * The server a pid file names, if it is still running. A pid file left by a server that has gone is removed. So is
 * one whose process lives on while the port is free, since the system has given that pid to something else.
 *
 * @param pidFile - The pid file.
 */
export const running = async (pidFile: string): Promise<Instance | undefined> => {
  if (!existsSync(pidFile)) return undefined
  let instance: Instance
  try {
    instance = JSON.parse(readFileSync(pidFile, 'utf8')) as Instance
  } catch {
    rmSync(pidFile, { force: true })
    return undefined
  }
  if (alive(instance.pid) && await taken(instance.port, instance.host)) return instance
  rmSync(pidFile, { force: true })
  return undefined
}

export interface StartOptions {
  /** What runs the server in the foreground, after `node`: a script and its arguments up to the options. */
  entry: string[]
  /** The options for the server, which `serve` takes. */
  args: string[]
  port: number
  host: string
  pidFile: string
  /** How long the server has to answer, in seconds. */
  readyTimeout: number
}

/**
 * Starts the server in the background and returns once `/jsonapi` answers, with the line `serve` prints. A server that
 * exits, or does not answer in time, is stopped, and the error carries its log.
 *
 * @param options - What to run and where.
 */
export const start = async (options: StartOptions): Promise<{ line: string, instance: Instance }> => {
  const { entry, args, port, host, pidFile, readyTimeout } = options
  const current = await running(pidFile)
  if (current) throw new Error(`A mock is already running on port ${current.port}, pid ${current.pid}: stop it first.`)
  const log = logFileFor(pidFile)
  const fd = openSync(log, 'w')
  const child = spawn(process.execPath, [...entry, ...args], { detached: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  child.unref()
  let exited: number | null | undefined
  child.on('exit', (code, signal) => {
    exited = code ?? (signal ? 1 : 0)
  })
  const instance: Instance = { pid: child.pid!, port, host, log }
  // Written before the server answers, so a start that is itself stopped leaves something for stop to find.
  writeFileSync(pidFile, JSON.stringify(instance))
  const deadline = Date.now() + readyTimeout * 1000
  const fail = (reason: string): never => {
    if (exited === undefined) child.kill('SIGKILL')
    rmSync(pidFile, { force: true })
    throw new Error(`${reason}\n${readFileSync(log, 'utf8').trim()}`)
  }
  for (;;) {
    const output = readFileSync(log, 'utf8')
    const line = output.split('\n').find((text) => text.includes(', listening on '))
    if (line) {
      instance.url = line.slice(line.lastIndexOf(' ') + 1)
      instance.preset = line.slice(0, line.indexOf(' from Drupal '))
      // Listening is not yet answering, and the issue a caller has is with the second.
      while (await answers(`${instance.url}/jsonapi`) === undefined) {
        if (exited !== undefined) fail(`The mock exited with status ${exited}.`)
        if (Date.now() > deadline) fail(`The mock did not answer within ${readyTimeout} seconds.`)
        await sleep(100)
      }
      writeFileSync(pidFile, JSON.stringify(instance))
      return { line: line.trim(), instance }
    }
    if (exited !== undefined) fail(`The mock exited with status ${exited} before it listened.`)
    if (Date.now() > deadline) fail(`The mock did not listen within ${readyTimeout} seconds.`)
    await sleep(100)
  }
}

/**
 * Stops the server a pid file names and returns once its port is free, or returns undefined when none was running.
 * A server that ignores SIGTERM for five seconds gets SIGKILL.
 *
 * @param pidFile - The pid file.
 */
export const stop = async (pidFile: string): Promise<Instance | undefined> => {
  const instance = await running(pidFile)
  if (!instance) return undefined
  process.kill(instance.pid, 'SIGTERM')
  for (let waited = 0; alive(instance.pid); waited += 50) {
    if (waited === 5000) process.kill(instance.pid, 'SIGKILL')
    await sleep(50)
  }
  while (await taken(instance.port, instance.host)) await sleep(50)
  rmSync(pidFile, { force: true })
  return instance
}

/**
 * Runs `start`, `status` or `stop` from a command line and ends the process with its status. `start` prints the line
 * `serve` prints and exits 0 once the server answers. `status` exits 0 when a server is running and 1 when none is.
 * `stop` exits 0 either way, so it is safe to call twice. A mistake is printed and ends the process with status 1.
 *
 * @param command - The command.
 * @param entry - What runs the server in the foreground, after `node`: a script and its arguments up to the options.
 * @param rest - The options, which may be any `serve` takes as well as `--pid-file` and `--ready-timeout`.
 */
export const daemonCommand = async (command: DaemonCommand, entry: string[], rest: string[]): Promise<void> => {
  const option = (name: string, fallback: string): string => {
    const index = rest.indexOf(`--${name}`)
    return index >= 0 && rest[index + 1] ? rest[index + 1]! : fallback
  }
  const port = Number(option('port', '3005'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be a port from 1 to 65535, not ${option('port', '3005')}.`)
    process.exit(1)
  }
  const readyTimeout = Number(option('ready-timeout', '30'))
  if (!(readyTimeout > 0)) {
    console.error(`--ready-timeout is a number of seconds, not ${option('ready-timeout', '30')}.`)
    process.exit(1)
  }
  const named = option('pid-file', '')
  const pidFile = pidFileFor(port, named || undefined)
  if (command === 'status') {
    const instance = await running(pidFile)
    if (!instance) {
      console.log(`No mock is running on port ${port}.`)
      process.exit(1)
    }
    console.log(`${instance.preset ?? 'A mock'} is running on ${instance.url ?? `port ${instance.port}`}, pid ${instance.pid}.`)
    return
  }
  if (command === 'stop') {
    const instance = await stop(pidFile)
    console.log(instance ? `Stopped the mock on port ${instance.port}, pid ${instance.pid}.` : `No mock is running on port ${port}.`)
    return
  }
  // The server is given the options serve takes, and none of these.
  const args = rest.filter((argument, index) => !['--pid-file', '--ready-timeout'].includes(argument) && !['--pid-file', '--ready-timeout'].includes(rest[index - 1]!))
  try {
    const { line } = await start({ entry, args, port, host: option('host', '127.0.0.1'), pidFile, readyTimeout })
    console.log(line)
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
