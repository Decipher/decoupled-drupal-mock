import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src'
import { loadDump, loadOverlay } from '../src/load'
import { createMock } from '../src/mock'
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

// Overlays made as anyone makes their own, from a build of the site with a module or a patch, and that site's real
// answers beside each. Druxt's language routing overlay was recorded from another install of the same Umami: its
// UUIDs and install times differ from the preset's, and the overlay tool aligns them. The claim each makes is that the
// baseline plus the overlay answers as that site did.
const overlaysDir = fileURLToPath(new URL('../../../examples/overlays', import.meta.url))
const overlayManifest = existsSync(join(overlaysDir, 'manifest.json')) ? JSON.parse(readFileSync(join(overlaysDir, 'manifest.json'), 'utf8')) as Record<string, string> : {}
const overlays = available && !process.env.DECOUPLED_DRUPAL_MOCK_DUMP ? readdirSync(overlaysDir).filter((file) => file.endsWith('.json.gz')).map((file) => file.replace(/\.json\.gz$/, '')) : []
const overlayFile = (name: string) => join(overlaysDir, `${name}.json.gz`)

describe.skipIf(!!process.env.DECOUPLED_DRUPAL_MOCK_DUMP)('the example overlays', () => {
  it('each have the real answers they are replayed against, and the hashes their manifest names', () => {
    expect(overlays.length).toBeGreaterThan(0)
    // The write scripts are there only for a site that was given some.
    const writes = overlays.map((name) => `oracle/${name}.writes.json.gz`).filter((file) => existsSync(join(overlaysDir, file)))
    expect(Object.keys(overlayManifest).sort()).toEqual([...overlays.flatMap((name) => [`${name}.json.gz`, `oracle/${name}.json.gz`]), ...writes].sort())
    for (const [file, hash] of Object.entries(overlayManifest)) expect(createHash('sha256').update(readFileSync(join(overlaysDir, file))).digest('hex'), file).toBe(hash)
  })
})

describe.skipIf(!overlays.length).each(overlays)('the %s overlay', (name) => {
  const dump = loadDump(dir!)
  const mock = createMock(dump, { baseUrl: dump.manifest.origin, extensions: [loadOverlay(dir!, overlayFile(name))] })
  const entries = JSON.parse(gunzipSync(readFileSync(join(overlaysDir, 'oracle', `${name}.json.gz`))).toString('utf8')) as Array<{ request: string, status: number, body: unknown }>

  it.each(entries.map((entry) => [entry.request, entry] as const))('%s', (_request, entry) => {
    const answer = mock.handle('GET', entry.request)
    expect(answer.status).toBe(entry.status)
    if (typeof entry.body !== 'string') expect(comparable(answer.body)).toEqual(comparable(entry.body))
  })
})

describe.skipIf(!available)('the dump\'s format', () => {
  const withFormat = (format: number | undefined) => {
    const copy = mkdtempSync(join(tmpdir(), 'format-'))
    cpSync(dir!, copy, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8')) as Record<string, unknown>
    if (format === undefined) delete manifest.format
    else manifest.format = format
    writeFileSync(join(copy, 'manifest.json'), JSON.stringify(manifest))
    return copy
  }

  // Whichever build the suite reads, named as its manifest names it.
  const preset = available ? (JSON.parse(readFileSync(join(dir!, 'manifest.json'), 'utf8')) as { preset: string }).preset : ''

  it('loads format 1, and a manifest from before formats were named', () => {
    expect(loadDump(withFormat(1)).manifest.preset).toBe(preset)
    expect(loadDump(withFormat(undefined)).manifest.preset).toBe(preset)
  })

  it('refuses a format this engine does not read, naming it', () => {
    expect(() => loadDump(withFormat(2))).toThrow(`${preset} is a dump of format 2, and this engine reads format 1.`)
  })
})

describe.skipIf(!overlays.length)('loading an overlay', () => {
  it('reads one of your own by its path, and names what is missing', () => {
    expect(loadOverlay(dir!, overlayFile('contact-storage')).name).toBe('contact-storage')
    expect(() => loadOverlay(dir!, './no/such.json.gz')).toThrow('No overlay file at')
    expect(() => loadOverlay(dir!, 'nope')).toThrow('No overlay named nope. This preset has: none. An overlay of your own is named by its path.')
  })
})

describe.skipIf(!overlays.includes('contact-storage'))('the overlays of what a preset lacks', () => {
  const dump = loadDump(dir!)
  const mockWith = (name?: string) => createMock(dump, { baseUrl: dump.manifest.origin, extensions: name ? [loadOverlay(dir!, overlayFile(name))] : [] })
  const path = '/en/jsonapi/contact_message/feedback'
  const body = JSON.stringify({ data: { type: 'contact_message--feedback', attributes: { subject: 'Hello', message: 'There', name: 'A visitor', mail: 'visitor@example.com' } } })
  const post = (mock: ReturnType<typeof mockWith>) => mock.handle('POST', `${dump.manifest.origin}${path}`, { 'content-type': 'application/vnd.api+json' }, body)

  it('adds a resource type only with the overlay', () => {
    expect(mockWith().handle('GET', `${dump.manifest.origin}${path}`).status).toBe(404)
    expect(mockWith('contact-storage').handle('GET', `${dump.manifest.origin}${path}`).status).toBe(200)
    expect(mockWith().handle('GET', `${dump.manifest.origin}/en/jsonapi/jsonapi_resource_config/jsonapi_resource_config`).status).toBe(404)
    expect(mockWith('jsonapi-extras').handle('GET', `${dump.manifest.origin}/en/jsonapi/jsonapi_resource_config/jsonapi_resource_config`).status).toBe(200)
  })

  it('takes a visitor\'s message, as real Drupal did', () => {
    expect(post(mockWith()).status).toBe(404)
    expect(post(mockWith('contact-storage')).status).toBe(201)
  })
})

