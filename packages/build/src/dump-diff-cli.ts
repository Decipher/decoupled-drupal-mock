#!/usr/bin/env -S node --experimental-strip-types
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { summarise } from './dump-diff.ts'

/* c8 ignore start */
const [from, to, fromOracle, toOracle] = process.argv.slice(2)
if (!to) {
  console.error('Usage: decoupled-drupal-mock-dump-diff <old dump> <new dump> [<old recordings> <new recordings>]')
  process.exit(1)
}
// Where a build's recordings are when none are named: `<dump>.oracle`, or `oracle/` beside a preset's `dump/`.
const oracleOf = (dir: string): string | undefined => [`${dir.replace(/\/+$/, '')}.oracle`, join(dirname(dir.replace(/\/+$/, '')), 'oracle')].find((candidate) => existsSync(join(candidate, 'reads.json.gz')))
process.stdout.write(summarise(from!, to, { from: fromOracle || oracleOf(from!), to: toOracle || oracleOf(to) }))
/* c8 ignore stop */
