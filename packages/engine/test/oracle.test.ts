import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src'
import { loadDump } from '../src/load'
import { comparable } from './comparable'

/**
 * The fidelity test: the engine against every oracle entry of a preset build, which is a real request with Drupal's
 * real answer. Set DECOUPLED_DRUPAL_MOCK_DUMP to a build directory; without one the suite is skipped.
 */
// The Umami preset's build by default, or any build directory.
const dir = process.env.DECOUPLED_DRUPAL_MOCK_DUMP || fileURLToPath(new URL('../../../presets/umami/dump', import.meta.url))
const available = !!dir && existsSync(join(dir, 'oracle', 'queries.json.gz'))

describe.skipIf(!available)('the engine against the oracle', () => {
  // The body runs even when skipped, so nothing is read without a build.
  const dump = available ? loadDump(dir!) : undefined
  const drupal = dump ? createDrupal(dump, { baseUrl: dump.manifest.origin }) : undefined
  const entries = available ? JSON.parse(gunzipSync(readFileSync(join(dir!, 'oracle', 'queries.json.gz'))).toString('utf8')) as Array<{ request: string, status: number, body: unknown }> : []

  it.each(entries.map((entry) => [entry.request, entry] as const))('%s', (_request, entry) => {
    const answer = drupal!.handle('GET', entry.request)
    expect(answer.status).toBe(entry.status)
    // Drupal's HTML pages are themed; the engine's are not. The status is what a client reads.
    if (typeof entry.body !== 'string') expect(comparable(answer.body)).toEqual(comparable(entry.body))
  })
})
