#!/usr/bin/env node
import { serveCommand } from 'decoupled-drupal-mock/cli'
import { dir } from './index.js'

// `npx decoupled-drupal-mock-dashi [options]` serves this preset, with the options `decoupled-drupal-mock serve` takes.
await serveCommand(dir, process.argv.slice(2))
