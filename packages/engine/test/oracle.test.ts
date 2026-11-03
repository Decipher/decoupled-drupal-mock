import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src'
import { loadDump } from '../src/load'
import { comparable } from './comparable'
import { oracleDir } from './oracle-dir.ts'

/**
 * The fidelity test: the engine against every oracle entry of a preset build, which is a real request with Drupal's
 * real answer. Set DECOUPLED_DRUPAL_MOCK_DUMP to a build directory; without one the suite is skipped.
 */
// The Umami preset's build by default, or any build directory.
const dir = process.env.DECOUPLED_DRUPAL_MOCK_DUMP || fileURLToPath(new URL('../../../presets/umami/dump', import.meta.url))
const available = !!dir && existsSync(join(oracleDir(dir), 'reads.json.gz'))

describe.skipIf(!available)('the engine against the oracle', () => {
  // The body runs even when skipped, so nothing is read without a build.
  const dump = available ? loadDump(dir!) : undefined
  const drupal = dump ? createDrupal(dump, { baseUrl: dump.manifest.origin }) : undefined
  const entries = available ? JSON.parse(gunzipSync(readFileSync(join(oracleDir(dir!), 'reads.json.gz'))).toString('utf8')) as Array<{ request: string, status: number, body: unknown }> : []

  it.each(entries.map((entry) => [entry.request, entry] as const))('%s', (_request, entry) => {
    const answer = drupal!.handle('GET', entry.request)
    expect(answer.status).toBe(entry.status)
    // Drupal's HTML pages are themed; the engine's are not. The status is what a client reads.
    if (typeof entry.body !== 'string') expect(comparable(answer.body)).toEqual(comparable(entry.body))
  })
})

describe.skipIf(!available)('the public files of a build', () => {
  it('holds every file its content names', () => {
    const dump = loadDump(dir!)
    const urls = Object.values(dump.resources).flatMap((types) => types['file--file'] || []).map((file) => (file.attributes as { uri?: { url?: string } } | undefined)?.uri?.url).filter((url): url is string => !!url?.startsWith('/sites/default/files/'))
    expect(urls.length).toBeGreaterThan(0)
    expect([...new Set(urls)].filter((url) => !existsSync(join(dir!, 'files', decodeURIComponent(url.slice('/sites/default/files/'.length)))))).toEqual([])
  })
})

describe.skipIf(!available)('the recordings of a build', () => {
  it('are outside the dump, and are the ones its manifest names', () => {
    const { manifest } = loadDump(dir!)
    expect(existsSync(join(dir!, 'oracle'))).toBe(false)
    for (const file of Object.keys(manifest.oracle || {})) {
      const text = gunzipSync(readFileSync(join(oracleDir(dir!), file))).toString('utf8')
      expect(text, file).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}/)
      // Whatever shape a token takes, the recorder writes `<token>` in its place.
      expect(text.match(/"(?:access_token|refresh_token|csrf_token|logout_token)":"(?!<token>")[^"]*"/g), file).toBeNull()
    }
    expect(Object.keys(manifest.oracle || {})).toContain('reads.json.gz')
    for (const [file, hash] of Object.entries(manifest.oracle || {})) expect(createHash('sha256').update(readFileSync(join(oracleDir(dir!), file))).digest('hex'), file).toBe(hash)
  })
})

