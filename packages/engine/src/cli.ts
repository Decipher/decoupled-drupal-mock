#!/usr/bin/env node
import { serveCommand, serveOptions } from './serve-command.js'

/**
 * `decoupled-drupal-mock serve <preset> [options]`: an HTTP server over a preset, named in short (`umami`), by its
 * package (`decoupled-drupal-mock-umami`) or by its build directory, as the backend for any frontend pointed at its
 * URL. `serveCommand` says what each option does.
 */
const [command, target, ...rest] = process.argv.slice(2)
if (command !== 'serve' || !target) {
  console.error(`Usage: decoupled-drupal-mock serve <preset> ${serveOptions}`)
  process.exit(1)
}
await serveCommand(target, rest)
