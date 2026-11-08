#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { presetCommand } from 'decoupled-drupal-mock/cli'
import { dir } from './index.js'

// `npx decoupled-drupal-mock-umami [options]` serves this preset, with the options `decoupled-drupal-mock serve` takes.
// `start`, `status` and `stop` run it in the background.
await presetCommand(dir, process.argv.slice(2), fileURLToPath(import.meta.url))
