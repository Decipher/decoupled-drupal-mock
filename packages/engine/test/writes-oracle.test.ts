import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src'
import type { Drupal, Dump } from '../src'
import { createMock } from '../src/mock'
import { KEPT_HEADERS, resolve, volatile } from '../src/recorded-writes'
import type { Answer, RecordedWrite } from '../src/recorded-writes'
import { loadDump, loadOverlay } from '../src/load'
import { oracleDir } from './oracle-dir.ts'

const isThemedOrToken = (answer: Answer, path: string): boolean => (typeof answer.body === 'string' && String(answer.headers['content-type']).includes('html')) || path === '/session/token'

/** The write and sign-in scripts a preset's build recorded, replayed on a fresh instance each. */
const dir = process.env.DECOUPLED_DRUPAL_MOCK_DUMP || fileURLToPath(new URL('../../../presets/umami/dump', import.meta.url))
const available = existsSync(join(oracleDir(dir), 'writes.json.gz'))

/**
 * Replays one recorded script on the instance given, step by step, against what Drupal answered.
 *
 * @param drupal - A fresh instance.
 * @param dump - The dump it answers from.
 * @param script - The script and Drupal's answers.
 */
const replay = (drupal: Pick<Drupal, 'handle'>, dump: Dump, script: RecordedWrite): void => {
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
  const answers: Answer[] = []
  script.steps.forEach((step, index) => {
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
    const label = `step ${index + 1}: ${resolved.method} ${resolved.path}`
    expect(got.status, label).toBe(expected.status)
    expect(volatile(got.headers), label).toEqual(volatile(expected.headers))
    // A themed page of Drupal's is not the mock's to copy, and a session token is new each time: both are compared by status and type.
    if (!isThemedOrToken(expected, resolved.path)) expect(volatile(got.body), label).toEqual(volatile(expected.body))
  })
}

const readScripts = (file: string): RecordedWrite[] => JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as RecordedWrite[]

describe.skipIf(!available)('the engine against the recorded scripts', () => {
  const dump = available ? loadDump(dir) : undefined
  const scripts = available ? readScripts(join(oracleDir(dir), 'writes.json.gz')) : []

  it.each(scripts.map((script) => [script.name, script] as const))('%s', (_name, script) => {
    replay(createDrupal(dump!, { baseUrl: dump!.manifest.origin }), dump!, script)
  })
})

// An overlay whose site was given write scripts carries Drupal's answers to them: the preset plus the overlay must
// answer each as that site did, not as the engine's model of the module would.
const overlaysDir = fileURLToPath(new URL('../../../examples/overlays', import.meta.url))
const withWrites = available && !process.env.DECOUPLED_DRUPAL_MOCK_DUMP && existsSync(join(overlaysDir, 'oracle'))
  ? readdirSync(join(overlaysDir, 'oracle')).filter((file) => file.endsWith('.writes.json.gz')).map((file) => file.replace(/\.writes\.json\.gz$/, ''))
  : []

describe.skipIf(!withWrites.length).each(withWrites)('the %s overlay against its recorded scripts', (name) => {
  const dump = loadDump(dir)
  const scripts = readScripts(join(overlaysDir, 'oracle', `${name}.writes.json.gz`))

  it.each(scripts.map((script) => [script.name, script] as const))('%s', (_name, script) => {
    replay(createMock(dump, { baseUrl: dump.manifest.origin, extensions: [loadOverlay(dir, join(overlaysDir, `${name}.json.gz`))] }), dump, script)
  })
})
