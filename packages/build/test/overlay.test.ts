import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { alignTo, diffBuilds, publishOverlayRecording, writeOverlay } from '../src/overlay'

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

const read = (dir: string, file: string): unknown => JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8'))
const manifest = { drupal: { core: '11', modules: {} }, languages: { en: 'en' } }
const route = (body: unknown, status = 200) => ({ status, headers: {}, body })
const node = (id: string, title: string) => ({ type: 'node--page', id, attributes: { title } })
const user = (changed: string) => ({ type: 'user--user', id: 'u', attributes: { name: 'a', changed, access: changed } })

describe('a variant from another install of the site', () => {
  // The same recipe and author in two installs: other UUIDs, other install times, the same internal ids.
  const recipe = (id: string, author: string, created: string, title = 'Quiche') => ({ type: 'node--recipe', id, attributes: { drupal_internal__nid: 1, langcode: 'en', title, created, changed: created }, relationships: { uid: { data: { type: 'user--user', id: author, meta: { drupal_internal__target_id: 2 } } } } })
  const user = (id: string, created: string) => ({ type: 'user--user', id, attributes: { drupal_internal__uid: 2, langcode: 'en', name: 'author', created } })
  const anonymous = (id: string) => ({ type: 'node--page', id: `page-${id}`, attributes: { drupal_internal__nid: 9, langcode: 'en' }, relationships: { uid: { data: { type: 'user--user', id, meta: { drupal_internal__target_id: 0 } } } } })
  const base = build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { 'GET /router/translate-path?path=/quiche': route({ entity: { uuid: 'r-base' } }) }, 'resources/en/node--recipe.json.gz': [recipe('r-base', 'u-base', '2026-01-01T00:00:00+00:00')], 'resources/en/user--user.json.gz': [user('u-base', '2026-01-01T00:00:00+00:00')], 'resources/en/node--page.json.gz': [anonymous('anon-base')] })
  const other = (title = 'Quiche') => build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { 'GET /router/translate-path?path=/quiche': route({ entity: { uuid: 'r-other' } }) }, 'resources/en/node--recipe.json.gz': [recipe('r-other', 'u-other', '2026-11-02T20:00:00+00:00', title)], 'resources/en/user--user.json.gz': [user('u-other', '2026-11-02T20:00:00+00:00')], 'resources/en/node--page.json.gz': [anonymous('anon-other')] })

  it('reads as the baseline\'s install: its UUIDs, by internal id and by relationship, and its install times', () => {
    const aligned = alignTo(base, other())(read(other(), 'resources/en/node--recipe.json.gz')) as Array<{ id: string, attributes: { created: string, changed: string }, relationships: { uid: { data: { id: string } } } }>
    expect(aligned[0]!.id).toBe('r-base')
    expect(aligned[0]!.relationships.uid.data.id).toBe('u-base')
    expect(aligned[0]!.attributes.created).toBe('2026-01-01T00:00:00+00:00')
    expect(aligned[0]!.attributes.changed).toBe('2026-01-01T00:00:00+00:00')
  })

  it('is no overlay at all when nothing but the install differs, and only the change when something does', () => {
    const nothing = diffBuilds(base, other(), 'nothing')
    expect(nothing.recorded).toEqual({})
    expect(nothing.resources).toEqual({})
    const changed = diffBuilds(base, other('Quiche, patched'), 'changed')
    expect(changed.resources.en!['node--recipe']).toEqual([expect.objectContaining({ id: 'r-base', attributes: expect.objectContaining({ title: 'Quiche, patched', created: '2026-01-01T00:00:00+00:00' }) })])
  })

  it('maps no UUID that two entities would share', () => {
    const twice = build({ 'manifest.json': manifest, 'resources/en/node--recipe.json.gz': [recipe('a', 'u-other', 'x'), { ...recipe('b', 'u-other', 'x') }] })
    const aligned = alignTo(base, twice)(read(twice, 'resources/en/node--recipe.json.gz')) as Array<{ id: string }>
    expect(aligned.map((resource) => resource.id)).toEqual(['a', 'b'])
  })
})

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

  it('puts the variant\'s recording beside its overlay, aligned as the overlay is, with both hashed in the directory\'s manifest', () => {
    const out = mkdtempSync(join(tmpdir(), 'overlays-'))
    const recording = join(build({ 'reads.json.gz': [{ request: '/x/r-other', status: 200, body: { data: { type: 'node--recipe', id: 'r-other' } } }] }), 'reads.json.gz')
    writeOverlay(diffBuilds(build({ 'manifest.json': manifest }), build({ 'manifest.json': manifest }), 'a-module'), out)
    publishOverlayRecording(recording, out, 'a-module', (value) => JSON.parse(JSON.stringify(value).replace(/r-other/g, 'r-base')))
    expect(read(out, 'oracle/a-module.json.gz')).toEqual([{ request: '/x/r-base', status: 200, body: { data: { type: 'node--recipe', id: 'r-base' } } }])
    const written = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Record<string, string>
    expect(Object.keys(written)).toEqual(['a-module.json.gz', 'oracle/a-module.json.gz'])
    expect(written['oracle/a-module.json.gz']).toBe(createHash('sha256').update(readFileSync(join(out, 'oracle', 'a-module.json.gz'))).digest('hex'))
  })

  it('writes what a preset loads', () => {
    const out = mkdtempSync(join(tmpdir(), 'overlays-'))
    const overlay = diffBuilds(build({ 'manifest.json': manifest }), build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { added: route({}) } }), 'written')
    writeOverlay(overlay, out)
    expect(JSON.parse(gunzipSync(readFileSync(join(out, 'written.json.gz'))).toString('utf8')).recorded).toHaveProperty('added')
  })
})
