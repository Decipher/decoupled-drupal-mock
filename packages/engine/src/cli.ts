#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { daemonCommand, daemonOptions } from './daemon.js'
import { serveCommand, serveOptions } from './serve-command.js'

/**
 * `decoupled-drupal-mock serve <preset> [options]`: an HTTP server over a preset, named in short (`umami`), by its
 * package (`decoupled-drupal-mock-umami`) or by its build directory, as the backend for any frontend pointed at its
 * URL. `serveCommand` says what each option does. `start` runs the same server in the background and returns once it
 * answers, and `status` and `stop` find it again by its port. `daemonCommand` says how.
 */
const [command, target, ...rest] = process.argv.slice(2)
if (command === 'serve' && target) {
  await serveCommand(target, rest)
} else if (command === 'start' && target && !target.startsWith('--')) {
  await daemonCommand('start', [fileURLToPath(import.meta.url), 'serve', target], rest)
} else if ((command === 'status' || command === 'stop') && (!target || target.startsWith('--'))) {
  // These take no preset, only the port or the pid file the server was started with.
  await daemonCommand(command, [], target ? [target, ...rest] : rest)
} else {
  console.error([
    `Usage: decoupled-drupal-mock serve <preset> ${serveOptions}`,
    `       decoupled-drupal-mock start <preset> ${serveOptions} ${daemonOptions}`,
    '       decoupled-drupal-mock status [--port 3005] [--pid-file <file>]',
    '       decoupled-drupal-mock stop [--port 3005] [--pid-file <file>]',
  ].join('\n'))
  process.exit(1)
}
