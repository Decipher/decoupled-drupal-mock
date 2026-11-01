#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { createDrupal } from './engine.js'
import { loadDump } from './load.js'
import { listen } from './serve.js'

/**
 * `decoupled-drupal-mock serve <preset> [--port 3005] [--host 127.0.0.1] [--base-url <url>] [--no-cors]`: an HTTP server over a preset,
 * named in short (`umami`), by its package (`decoupled-drupal-mock-umami`) or by its build directory, as the backend
 * for any frontend pointed at its URL. `--host 0.0.0.0` reaches it from outside a container.
 * `--base-url` is the address the answers' links name, for a server reached through another one, such as a forwarded
 * port.
 */
const [command, target, ...rest] = process.argv.slice(2)
const option = (name: string, fallback: string): string => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 && rest[index + 1] ? rest[index + 1]! : fallback
}
if (command !== 'serve' || !target) {
  console.error('Usage: decoupled-drupal-mock serve <preset> [--port 3005] [--host 127.0.0.1] [--base-url <url>] [--no-cors]')
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
let dir = target
// A directory on disk, else a preset package by its name or its short name.
if (!existsSync(target)) {
  // A path that is not there is a mistake to name, not a package to look for.
  const isPackage = !target.startsWith('.') && !target.startsWith('/') && (target.startsWith('@') ? target.split('/').length === 2 : !target.includes('/'))
  const candidates = !isPackage ? [] : target.includes('-') || target.startsWith('@') ? [target] : [`decoupled-drupal-mock-${target}`, target]
  let found: string | undefined
  for (const candidate of candidates) {
    try {
      found = (await import(import.meta.resolve(candidate)) as { dir: string }).dir
      break
    } catch {
      // The next name.
    }
  }
  if (!found) {
    console.error(`${target} is ${isPackage ? 'not an installed preset package' : 'not a directory'}. Name a preset package or a build directory holding manifest.json.`)
    process.exit(1)
  }
  dir = found
}
const dump = loadDump(dir)
const drupal = createDrupal(dump, { baseUrl })
const { url } = await listen(drupal, port, host, { files: dir, cors: !rest.includes('--no-cors') })
console.log(`${dump.manifest.preset} from Drupal ${dump.manifest.drupal.core}, listening on ${url}`)
