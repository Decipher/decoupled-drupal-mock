import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { diffBuilds, publishOverlayRecording, writeOverlay } from '../src/overlay'

/** A build directory from a map of its files. */
const build = (files: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'overlay-'))
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    const text = Buffer.from(JSON.stringify(body))
    writeFileSync(join(dir, file), file.endsWith('.gz') ? gzipSync(text) : text)
  }
  return dir
}

const manifest = { drupal: { core: '11', modules: {} }, languages: { en: 'en' } }
const route = (body: unknown, status = 200) => ({ status, headers: {}, body })
const node = (id: string, title: string) => ({ type: 'node--page', id, attributes: { title } })
const user = (changed: string) => ({ type: 'user--user', id: 'u', attributes: { name: 'a', changed, access: changed } })

describe('the difference between two builds', () => {
  it('keeps only what the variant answers differently', () => {
    const base = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { same: route({ a: 1 }), changed: route({ a: 1 }), gone: route({}) }, 'resources/en/node--page.json.gz': [node('1', 'One')], 'index/en.json': { links: {} } })
    const variant = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { same: route({ a: 1 }), changed: route({ a: 2 }), added: route({}) }, 'resources/en/node--page.json.gz': [node('1', 'Two')], 'resources/en/thing--thing.json.gz': [node('2', 'New')], 'index/en.json': { links: { 'thing--thing': {} } }, 'access/en.json.gz': { 'node--page': { hidden: ['x'] } } })
    const overlay = diffBuilds(base, variant, 'a-change')
    expect(overlay.name).toBe('a-change')
    expect(Object.keys(overlay.recorded).sort()).toEqual(['added', 'changed'])
    expect(overlay.removed).toEqual(['gone'])
    expect(Object.keys(overlay.resources.en!).sort()).toEqual(['node--page', 'thing--thing'])
    expect(overlay.index.en).toEqual({ links: { 'thing--thing': {} } })
    expect(overlay.access.en).toEqual({ 'node--page': { hidden: ['x'] } })
  })

  it('ignores what differs between any two recordings: a sign-in time and a themed page', () => {
    const base = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { page: route('<html>one', 404) }, 'resources/en/user--user.json.gz': [user('2026-01-01')] })
    const variant = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { page: route('<html>two', 404) }, 'resources/en/user--user.json.gz': [user('2026-02-02')] })
    const overlay = diffBuilds(base, variant, 'nothing')
    expect(overlay.recorded).toEqual({})
    expect(overlay.resources).toEqual({})
  })

  it('still sees a themed page whose status changed', () => {
    const base = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { page: route('<html>', 404) } })
    const variant = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { page: route('<html>', 200) } })
    expect(Object.keys(diffBuilds(base, variant, 'status').recorded)).toEqual(['page'])
  })

  it('records a type the variant lacks as removed, and a content type that changed', () => {
    const base = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { page: { status: 200, headers: { 'content-type': 'text/html' }, body: 'x' } }, 'resources/en/node--page.json.gz': [node('1', 'One')] })
    const variant = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { page: { status: 200, headers: { 'content-type': 'application/json' }, body: 'x' } } })
    const overlay = diffBuilds(base, variant, 'gone')
    expect(overlay.removedTypes).toEqual({ en: ['node--page'] })
    expect(overlay.resources).toEqual({})
    expect(Object.keys(overlay.recorded)).toEqual(['page'])
  })

  it('stops at a build it cannot read, or a variant that lost its recordings', () => {
    const base = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { page: route({}) } })
    expect(() => diffBuilds(base, build({ 'manifest.json': manifest }), 'lost')).toThrow('has no recorded/routes.json.gz')
    const broken = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': {} })
    writeFileSync(join(broken, 'recorded', 'routes.json.gz'), 'not gzip')
    expect(() => diffBuilds(base, broken, 'broken')).toThrow('cannot be read')
  })

  it('refuses a variant with no manifest, which is not a finished build', () => {
    expect(() => diffBuilds(build({ 'manifest.json': manifest }), build({}), 'unfinished')).toThrow('has no manifest.json')
  })

  it('puts the variant\'s recording beside the preset, and its hash in the preset\'s manifest', () => {
    const preset = build({ 'dump/manifest.json': { preset: 'p', oracle: { 'reads.json.gz': 'abc' } } })
    const recording = join(build({ 'reads.json.gz': [{ request: '/x', status: 200, body: {} }] }), 'reads.json.gz')
    publishOverlayRecording(recording, preset, 'a-module')
    const bytes = readFileSync(join(preset, 'oracle', 'overlays', 'a-module.json.gz'))
    expect(bytes.equals(readFileSync(recording))).toBe(true)
    const written = JSON.parse(readFileSync(join(preset, 'dump', 'manifest.json'), 'utf8')) as { oracle: Record<string, string> }
    expect(written.oracle).toEqual({ 'reads.json.gz': 'abc', 'overlays/a-module.json.gz': createHash('sha256').update(bytes).digest('hex') })
  })

  it('writes what a preset loads', () => {
    const out = mkdtempSync(join(tmpdir(), 'overlays-'))
    const overlay = diffBuilds(build({ 'manifest.json': manifest }), build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { added: route({}) } }), 'written')
    writeOverlay(overlay, out)
    expect(JSON.parse(gunzipSync(readFileSync(join(out, 'written.json.gz'))).toString('utf8')).recorded).toHaveProperty('added')
  })
})
