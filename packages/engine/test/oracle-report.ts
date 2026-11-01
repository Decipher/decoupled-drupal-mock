// A report of the engine against a build's oracle: the first difference per entry, grouped. Run with
// node --experimental-strip-types packages/engine/test/oracle-report.ts <build dir>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createDrupal } from '../dist/index.js'
import { loadDump } from '../dist/load.js'
import { comparable } from './comparable.ts'

const dir = process.argv[2]!
const dump = loadDump(dir)
const drupal = createDrupal(dump, { baseUrl: dump.manifest.origin })
const entries = JSON.parse(gunzipSync(readFileSync(join(dir, 'oracle', 'queries.json.gz'))).toString('utf8')) as Array<{ request: string, status: number, body: unknown }>

/** The first path where two values differ, with both sides. */
const diff = (a: unknown, b: unknown, path = '$'): string | undefined => {
  if (a === b) return undefined
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: engine ${JSON.stringify(a)?.slice(0, 80)} | drupal ${JSON.stringify(b)?.slice(0, 80)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length engine ${a.length} | drupal ${b.length}`
    for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`); if (d) return d }
    return undefined
  }
  const x = a as Record<string, unknown>; const y = b as Record<string, unknown>
  const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])]
  for (const key of keys) {
    if (!(key in x)) return `${path}.${key}: missing in engine`
    if (!(key in y)) return `${path}.${key}: extra in engine`
    const d = diff(x[key], y[key], `${path}.${key}`); if (d) return d
  }
  // Key order matters to a byte comparison, not to equality.
  return undefined
}

const groups = new Map<string, string[]>()
let ok = 0
for (const entry of entries) {
  const answer = drupal.handle('GET', entry.request)
  const d = answer.status !== entry.status ? `status engine ${answer.status} | drupal ${entry.status}` : typeof entry.body === 'string' ? undefined : diff(comparable(answer.body), comparable(entry.body))
  if (!d) { ok++; continue }
  const key = d.replace(/\[\d+\]/g, '[]').replace(/engine .*$/, '').slice(0, 90)
  groups.set(key, [...(groups.get(key) || []), `${entry.request}\n      ${d.slice(0, 260)}`])
}
console.log(`${ok}/${entries.length} match`)
for (const [key, requests] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${requests.length}x ${key}`)
  for (const request of requests.slice(0, 2)) { let text = request; try { text = decodeURIComponent(request) } catch { /* a raw percent */ } console.log(`   ${text.slice(0, 420)}`) }
}
