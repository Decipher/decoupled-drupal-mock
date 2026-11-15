import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, ftruncateSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
  /**
   * When the process started and its command line, as `ps` saw them right after it started. A process the system
   * later gives the same pid started at another time, so this is what says the pid is still the server.
   */
  identity: string
  /** Set once the server listens. */
  url?: string
  /** Set once the server listens. */
  preset?: string
}

/**
 * A directory of the user's own under the system's temporary directory, which nobody else can write to. Another user
 * could otherwise leave a link where the pid file or the log is written, and have it written somewhere else.
 */
const ownDir = (): string => {
  const uid = process.getuid?.()
  const dir = join(tmpdir(), `decoupled-drupal-mock-${uid ?? 'user'}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stat = lstatSync(dir)
  if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o077) !== 0) {
    throw new Error(`${dir} is not a directory that only you can write to: remove it, or name a pid file with --pid-file.`)
  }
  return dir
}

/**
 * The pid file for a port, in a directory of the user's own under the system's temporary directory unless one is named.
 *
 * @param port - The port the server listens on.
 * @param pidFile - The file to use instead.
 */
export const pidFileFor = (port: number, pidFile?: string): string => pidFile ? resolve(pidFile) : join(ownDir(), `${port}.pid`)

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

/** When a process started in clock ticks since boot, where Linux says, which is finer than the second `ps` gives. */
const ticksOf = (pid: number): string | undefined => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // The fields after the command's closing bracket start at the third, and the start time is the twenty-second.
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  } catch {
    return undefined
  }
}

/**
 * When a process started and its command line, as `ps` gives them, or undefined when it has gone or `ps` cannot say.
 * On Linux the start time in clock ticks comes first.
 *
 * @param pid - The process.
 */
export const identityOf = (pid: number): string | undefined => {
  let said: string
  try {
    const env = { ...process.env, LC_ALL: 'C' }
    said = execFileSync('ps', ['-ww', '-o', 'lstart=', '-o', 'args=', '-p', String(pid)], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
  if (!said) return undefined
  const ticks = ticksOf(pid)
  return ticks ? `${ticks} ${said}` : said
}

/**
 * Whether a pid is still the process a record names. `unknown` means it is there but `ps` cannot say what it is,
 * and nothing is signalled or forgotten on a guess.
 */
const whose = (instance: Instance): 'ours' | 'gone' | 'unknown' => {
  if (!alive(instance.pid)) return 'gone'
  const identity = identityOf(instance.pid)
  if (identity === undefined) return alive(instance.pid) ? 'unknown' : 'gone'
  return identity === instance.identity ? 'ours' : 'gone'
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

/** Whether a pid file holds a record `start` wrote. A pid of 0 or less would signal a whole process group. */
const isInstance = (value: unknown): value is Instance => {
  const record = value as Partial<Instance> | null
  return typeof record === 'object' && record !== null && Number.isInteger(record.pid) && record.pid! > 0 && Number.isInteger(record.port) && typeof record.host === 'string' && typeof record.identity === 'string'
}

/** A file of this process's own beside the pid file, created rather than opened, so no link is followed. */
const scratch = (pidFile: string, text: string): string => {
  const file = `${pidFile}.${process.pid}.${randomUUID()}`
  writeFileSync(file, text, { flag: 'wx', mode: 0o600 })
  return file
}

/** Replaces the record in one step, so a reader sees the old record or the new one and never part of either. */
const replace = (pidFile: string, text: string): void => {
  renameSync(scratch(pidFile, text), pidFile)
}

/**
 * Creates the record only if there is none, in one step. A link cannot replace a file, and the record is whole
 * before the link makes it visible.
 *
 * @returns Whether this call created it.
 */
const claim = (pidFile: string, text: string): boolean => {
  const file = scratch(pidFile, text)
  try {
    linkSync(file, pidFile)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    rmSync(file, { force: true })
  }
}

/**
 * Removes the record only if it still says what it said when it was read. It is moved aside first, which is one step,
 * and put back if another process wrote it in between.
 */
const forget = (pidFile: string, text: string): void => {
  const aside = `${pidFile}.${process.pid}.${randomUUID()}`
  try {
    renameSync(pidFile, aside)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  try {
    if (readFileSync(aside, 'utf8') !== text) linkSync(aside, pidFile)
  } catch {
    // Another start has claimed the file meanwhile, and its record is the one to keep.
  } finally {
    rmSync(aside, { force: true })
  }
}

/** The pid file's text, or undefined when there is none. A file that is not the user's own is refused, not read. */
const read = (pidFile: string): string | undefined => {
  let stat
  try {
    stat = lstatSync(pidFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const uid = process.getuid?.()
  if (!stat.isFile() || (uid !== undefined && stat.uid !== uid)) {
    throw new Error(`${pidFile} is not a file of your own, so it cannot say which process to signal.`)
  }
  return readFileSync(pidFile, 'utf8')
}

/** The record and its text, if the process it names is still the one that wrote it. */
const current = (pidFile: string): { instance: Instance, text: string } | undefined => {
  const text = read(pidFile)
  if (text === undefined) return undefined
  let instance: unknown
  try {
    instance = JSON.parse(text)
  } catch {
    instance = undefined
  }
  if (!isInstance(instance)) {
    forget(pidFile, text)
    return undefined
  }
  const state = whose(instance)
  if (state === 'gone') {
    forget(pidFile, text)
    return undefined
  }
  if (state === 'unknown') {
    throw new Error(`ps cannot say whether pid ${instance.pid} is still the mock, so it is left alone. Check it, then remove ${pidFile}.`)
  }
  return { instance, text }
}

/**
 * The server a pid file names, if it is still running. A pid file left by a server that has gone is removed. So is
 * one whose pid now belongs to something else, which started at another time.
 *
 * @param pidFile - The pid file.
 */
export const running = async (pidFile: string): Promise<Instance | undefined> => current(pidFile)?.instance

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
 * Opens the log for writing without following a link, and only once it is a file of the user's own with no other
 * name. A log beside a pid file in a shared directory could otherwise be made to empty someone's file.
 */
const openLog = (log: string): number => {
  const refused = new Error(`${log} is not a file of your own, so the mock will not write its log there.`)
  let fd: number
  try {
    fd = openSync(log, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
  } catch (error) {
    // The log's name is a link.
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw refused
    throw error
  }
  const stat = fstatSync(fd)
  const uid = process.getuid?.()
  if (!stat.isFile() || stat.nlink !== 1 || (uid !== undefined && stat.uid !== uid)) {
    closeSync(fd)
    throw refused
  }
  ftruncateSync(fd, 0)
  return fd
}

/**
 * Starts the server in the background and returns once `/jsonapi` answers, with the line `serve` prints. A server that
 * exits, or does not answer in time, is stopped, and the error carries its log.
 *
 * @param options - What to run and where.
 */
export const start = async (options: StartOptions): Promise<{ line: string, instance: Instance }> => {
  const { entry, args, port, host, pidFile, readyTimeout } = options
  const found = current(pidFile)
  if (found) throw new Error(`A mock is already running on port ${found.instance.port}, pid ${found.instance.pid}: stop it first.`)
  const log = logFileFor(pidFile)
  const own = identityOf(process.pid)
  if (own === undefined) throw new Error('ps cannot say when this process started, so start cannot record which process the server is.')
  // Claimed before anything runs, so two starts at once cannot both run a server. Until the server's own pid replaces
  // it, the record names this process, which is the one to stop.
  let text = JSON.stringify({ pid: process.pid, port, host, log, identity: own })
  if (!claim(pidFile, text)) throw new Error(`A mock is already starting on port ${port}: stop it first.`)
  let child: ChildProcess | undefined
  let exited: number | null | undefined
  const end = (): void => {
    if (child && exited === undefined) child.kill('SIGKILL')
    forget(pidFile, text)
  }
  // A stop that read the claim signals this process. Until start returns, this process ends the server it started
  // and gives up the record before it ends as the signal asks, so no server is left running without a record.
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const
  const handOff = (name: NodeJS.Signals): void => {
    end()
    release()
    process.kill(process.pid, name)
  }
  const release = (): void => {
    for (const name of signals) process.off(name, handOff)
  }
  for (const name of signals) process.on(name, handOff)
  const fail = (reason: string): never => {
    end()
    throw new Error(`${reason}\n${readFileSync(log, 'utf8').trim()}`)
  }
  try {
    let fd: number
    try {
      fd = openLog(log)
    } catch (error) {
      forget(pidFile, text)
      throw error
    }
    child = spawn(process.execPath, [...entry, ...args], { detached: true, stdio: ['ignore', fd, fd] })
    closeSync(fd)
    child.on('error', () => {
      exited ??= 1
    })
    child.on('exit', (code, name) => {
      exited = code ?? (name ? 1 : 0)
    })
    if (child.pid === undefined) {
      forget(pidFile, text)
      throw new Error(`The mock did not start: ${process.execPath} could not be run.`)
    }
    child.unref()
    const identity = identityOf(child.pid)
    if (identity === undefined) fail('ps cannot say when the mock started, so it was stopped rather than left unrecorded.')
    const instance: Instance = { pid: child.pid, port, host, log, identity: identity! }
    // Written before the server answers, so a start that is itself stopped leaves something for stop to find.
    try {
      replace(pidFile, JSON.stringify(instance))
      text = JSON.stringify(instance)
    } catch (error) {
      fail((error as Error).message)
    }
    const deadline = Date.now() + readyTimeout * 1000
    for (;;) {
      const output = readFileSync(log, 'utf8')
      const line = output.split('\n').find((said) => said.includes(', listening on '))
      if (line) {
        instance.url = line.slice(line.lastIndexOf(' ') + 1)
        instance.preset = line.slice(0, line.indexOf(' from Drupal '))
        // Listening is not yet answering, and the issue a caller has is with the second.
        while (await answers(`${instance.url}/jsonapi`) === undefined) {
          if (exited !== undefined) fail(`The mock exited with status ${exited}.`)
          if (Date.now() > deadline) fail(`The mock did not answer within ${readyTimeout} seconds.`)
          await sleep(100)
        }
        replace(pidFile, JSON.stringify(instance))
        return { line: line.trim(), instance }
      }
      if (exited !== undefined) fail(`The mock exited with status ${exited} before it listened.`)
      if (Date.now() > deadline) fail(`The mock did not listen within ${readyTimeout} seconds.`)
      await sleep(100)
    }
  } finally {
    release()
  }
}

/**
 * Stops the server a pid file names and returns once its port is free, or returns undefined when none was running.
 * A server that ignores SIGTERM for five seconds gets SIGKILL, once its pid is checked again. A process that is still
 * there five seconds after that has ended and not been reaped, so the port alone says when it is done, and a port
 * still held then is an error.
 *
 * @param pidFile - The pid file.
 */
export const stop = async (pidFile: string): Promise<Instance | undefined> => {
  const found = current(pidFile)
  if (!found) return undefined
  const { instance, text } = found
  const signal = (name: NodeJS.Signals): boolean => {
    try {
      process.kill(instance.pid, name)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }
  let there = signal('SIGTERM')
  for (let waited = 0; there && waited < 10000; waited += 50) {
    await sleep(50)
    there = whose(instance) !== 'gone'
    if (there && waited === 5000) {
      const state = whose(instance)
      if (state === 'unknown') throw new Error(`ps cannot say whether pid ${instance.pid} is still the mock, so it was sent SIGTERM and not SIGKILL. Check it, then remove ${pidFile}.`)
      there = state === 'ours' && signal('SIGKILL')
    }
  }
  for (let waited = 0; await taken(instance.port, instance.host); waited += 50) {
    if (waited >= 5000) throw new Error(`Port ${instance.port} is still in use after stopping pid ${instance.pid}.`)
    await sleep(50)
  }
  forget(pidFile, text)
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
  const at = rest.indexOf('--pid-file')
  if (at >= 0 && (!rest[at + 1] || rest[at + 1]!.startsWith('--'))) {
    console.error('--pid-file names a file: --pid-file ./mock.pid')
    process.exit(1)
  }
  // A failure is printed and ends the process, which a test that stubs process.exit sees as the same.
  const orExit = async <T>(work: () => T | Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      console.error((error as Error).message)
      return process.exit(1)
    }
  }
  const pidFile = await orExit(() => pidFileFor(port, at >= 0 ? rest[at + 1] : undefined))
  if (command === 'status') {
    const instance = await orExit(() => running(pidFile))
    if (!instance) {
      console.log(`No mock is running on port ${port}.`)
      process.exit(1)
    }
    console.log(instance.url ? `${instance.preset ?? 'A mock'} is running on ${instance.url}, pid ${instance.pid}.` : `A mock is starting on port ${instance.port}, pid ${instance.pid}.`)
    return
  }
  if (command === 'stop') {
    const instance = await orExit(() => stop(pidFile))
    console.log(instance ? `Stopped the mock on port ${instance.port}, pid ${instance.pid}.` : `No mock is running on port ${port}.`)
    return
  }
  // The server is given the options serve takes, and none of these.
  const args = rest.filter((argument, index) => !['--pid-file', '--ready-timeout'].includes(argument) && !['--pid-file', '--ready-timeout'].includes(rest[index - 1]!))
  const { line } = await orExit(() => start({ entry, args, port, host: option('host', '127.0.0.1'), pidFile, readyTimeout }))
  console.log(line)
}
