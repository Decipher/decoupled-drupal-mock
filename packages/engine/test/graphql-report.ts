// A report of the engine against a build's recorded GraphQL queries: each entry's first difference. Run with
// node --experimental-strip-types packages/engine/test/graphql-report.ts <build dir>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createDrupal } from '../dist/graphql.js'
import { loadDump } from '../dist/load.js'
import { diff } from './diff.ts'
import { oracleDir } from './oracle-dir.ts'

interface Entry { name: string, query: string, variables?: Record<string, unknown>, status: number, answer: unknown }

const dir = process.argv[2]!
const dump = loadDump(dir)
const entries = JSON.parse(gunzipSync(readFileSync(join(oracleDir(dir), 'graphql.json.gz'))).toString('utf8')) as Entry[]
const drupal = createDrupal(dump, { baseUrl: dump.manifest.origin })
let ok = 0
for (const entry of entries) {
  const { status, body } = drupal.handle('POST', `${dump.manifest.origin}${dump.graphql!.compose.endpoint}`, { 'content-type': 'application/json' }, JSON.stringify({ query: entry.query, ...(entry.variables ? { variables: entry.variables } : {}) }))
  const d = status !== entry.status ? `status engine ${status} | drupal ${entry.status}` : diff(body, entry.answer)
  if (d) console.log(`  ${entry.name}: ${d}`)
  else ok++
}
console.log(`\n${ok}/${entries.length} queries match`)
