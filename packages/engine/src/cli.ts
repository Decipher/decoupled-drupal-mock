#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { Extension } from './extend.js'
import { createMock } from './mock.js'
import { loadDump, loadOverlay } from './load.js'
import { presetDir } from './preset.js'
import { listen } from './serve.js'

/**
 * `decoupled-drupal-mock serve <preset> [--port 3005] [--host 127.0.0.1] [--base-url <url>] [--no-cors] [--control] [--extension <file>] [--overlay <name>]`: an HTTP server over a preset,
 * named in short (`umami`), by its package (`decoupled-drupal-mock-umami`) or by its build directory, as the backend
 * for any frontend pointed at its URL. `--host 0.0.0.0` reaches it from outside a container.
 * `--base-url` is the address the answers' links name, for a server reached through another one, such as a forwarded
 * port. `--control` opens the routes a test uses to reset the writes and to sign in, for a test's server only.
 * `--extension` loads a module whose default export is an extension, and can be given more than once.
 * `--overlay` adds a recorded overlay the preset ships, such as a patch or a module, and can too.
 */
const [command, target, ...rest] = process.argv.slice(2)
const option = (name: string, fallback: string): string => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 && rest[index + 1] ? rest[index + 1]! : fallback
}
if (command !== 'serve' || !target) {
  console.error('Usage: decoupled-drupal-mock serve <preset> [--port 3005] [--host 127.0.0.1] [--base-url <url>] [--no-cors] [--control] [--extension <file>] [--overlay <name>]')
  process.exit(1)
}
const port = Number(option('port', '3005'))
const host = option('host', '127.0.0.1')
// The links are written before the server binds, so a port the system would pick cannot be named in them.
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`--port must be a port from 1 to 65535, not ${option('port', '3005')}.`)
  process.exit(1)
}
// An address to bind is not always one to reach: no client can follow a link to 0.0.0.0.
const reachable = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
const baseUrl = option('base-url', `http://${reachable.includes(':') ? `[${reachable}]` : reachable}:${port}`)
let dir: string
try {
  dir = presetDir(target)
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}
const dump = loadDump(dir)
const extensions: Extension[] = []
for (const [index, argument] of rest.entries()) {
  if (argument !== '--extension') continue
  if (!rest[index + 1] || rest[index + 1]!.startsWith('--')) {
    console.error('--extension names a file: --extension ./my-extension.mjs')
    process.exit(1)
  }
  try {
    const loaded = (await import(pathToFileURL(resolve(rest[index + 1]!)).href) as { default?: Extension }).default
    if (!loaded || typeof loaded !== 'object') throw new Error('it has no default export of an extension')
    extensions.push(loaded)
  } catch (error) {
    console.error(`The extension ${rest[index + 1]} did not load: ${(error as Error).message}`)
    process.exit(1)
  }
}
for (const [index, argument] of rest.entries()) {
  if (argument !== '--overlay' || !rest[index + 1]) continue
  try {
    extensions.push(loadOverlay(dir, rest[index + 1]!))
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
const drupal = createMock(dump, { baseUrl, extensions })
const { url } = await listen(drupal, port, host, { files: dir, cors: !rest.includes('--no-cors'), control: rest.includes('--control') }).catch((error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use: name another with --port.` : error.message)
  process.exit(1)
})
console.log(`${dump.manifest.preset} from Drupal ${dump.manifest.drupal.core}, listening on ${url}`)
