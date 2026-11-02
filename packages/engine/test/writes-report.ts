// A report of the engine against a build's recorded scripts: every step's first difference. Run with
// node --experimental-strip-types packages/engine/test/writes-report.ts <build dir>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createDrupal } from '../dist/index.js'
import { KEPT_HEADERS, resolve, volatile } from '../dist/recorded-writes.js'
import type { Answer, RecordedWrite } from '../dist/recorded-writes.js'
import { loadDump } from '../dist/load.js'
import { diff } from './diff.ts'
import { oracleDir } from './oracle-dir.ts'

const dir = process.argv[2]!
const dump = loadDump(dir)
const scripts = JSON.parse(gunzipSync(readFileSync(join(oracleDir(dir), 'writes.json.gz'))).toString('utf8')) as RecordedWrite[]
let ok = 0, total = 0, shallow = 0
for (const script of scripts) {
  const drupal = createDrupal(dump, { baseUrl: dump.manifest.origin })
  const resourceId = (type: string, index: number) => dump.resources[dump.manifest.defaultLanguage]?.[type]?.[index]?.id
  const tokens = new Map<string, string | undefined>()
  const tokenFor = (name: string): string | undefined => {
    if (name === 'anonymous') return undefined
    if (!tokens.has(name)) {
      const consumer = dump.identities!.consumers.find((candidate) => candidate.user === name && candidate.grants.includes('client_credentials'))!
      const scope = Object.keys(consumer.scopes || {})[0]
      const granted = drupal.handle('POST', `${dump.manifest.origin}/oauth/token`, { 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ grant_type: 'client_credentials', client_id: consumer.clientId, ...(consumer.secret ? { client_secret: consumer.secret } : {}), ...(scope ? { scope } : {}) }).toString())
      tokens.set(name, (granted.body as { access_token?: string }).access_token)
    }
    return tokens.get(name)
  }
  console.log(`\n== ${script.name}`)
  const answers: Answer[] = []
  script.steps.forEach((step, index) => {
    total++
    const resolved = resolve(step, answers, resourceId)
    const headers: Record<string, string> = {}
    const bearer = resolved.bearer ?? tokenFor(resolved.as || script.as)
    if (bearer) headers.authorization = `Bearer ${bearer}`
    let body: string | undefined
    if (resolved.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(resolved.form).toString() }
    else if (resolved.json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(resolved.json) }
    else if (resolved.body !== undefined) { headers['content-type'] = 'application/vnd.api+json'; body = JSON.stringify(resolved.body) }
    const answer = drupal.handle(resolved.method, `${dump.manifest.origin}${resolved.path}`, headers, body)
    const kept = Object.fromEntries(KEPT_HEADERS.map((name) => [name, Object.entries(answer.headers).find(([key]) => key.toLowerCase() === name)?.[1]]).filter(([, value]) => value).map(([name, value]) => [name, name === 'content-type' ? String(value).split(';')[0]!.trim() : String(value)]))
    const got: Answer = { status: answer.status, headers: kept, body: answer.body }
    answers.push(got)
    const expected = script.answers[index]!
    if ((typeof expected.body === 'string' && String(expected.headers['content-type']).includes('html')) || resolved.path === '/session/token') shallow++
    const d = got.status !== expected.status ? `status engine ${got.status} | drupal ${expected.status}` : diff(volatile(got.headers), volatile(expected.headers), 'headers') || ((typeof expected.body === 'string' && String(expected.headers['content-type']).includes('html')) || resolved.path === '/session/token' ? undefined : diff(volatile(got.body), volatile(expected.body)))
    if (d) console.log(`  step ${index + 1} ${resolved.method} ${resolved.path.slice(0, 70)}: ${d}`)
    else ok++
  })
}
console.log(`\n${ok}/${total} steps match, ${shallow} of them on status and headers only: a themed page or a new session token`)
