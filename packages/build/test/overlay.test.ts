import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { diffBuilds, writeOverlay } from '../src/overlay'

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

  it('writes what a preset loads', () => {
    const out = mkdtempSync(join(tmpdir(), 'overlays-'))
    const overlay = diffBuilds(build({ 'manifest.json': manifest }), build({ 'manifest.json': manifest, 'recorded/routes.json.gz': { added: route({}) } }), 'written')
    writeOverlay(overlay, out)
    expect(JSON.parse(gunzipSync(readFileSync(join(out, 'written.json.gz'))).toString('utf8')).recorded).toHaveProperty('added')
  })
})
