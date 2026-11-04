import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { summarise } from '../src/dump-diff'

/** A build directory from a map of its files. */
const build = (files: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dump-diff-'))
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    const text = Buffer.from(JSON.stringify(body))
    writeFileSync(join(dir, file), file.endsWith('.gz') ? gzipSync(text) : text)
  }
  return dir
}

const manifest = (core: string, modules: Record<string, string>) => ({ preset: 'p', defaultLanguage: 'en', languages: { en: 'en' }, drupal: { core, profile: 'demo_umami', modules } })
const user = (id: string, uid: number, name: string, created: string) => ({ type: 'user--user', id, attributes: { drupal_internal__uid: uid, name, created, changed: created } })
const page = (id: string, nid: number, title: string, created: string) => ({ type: 'node--page', id, attributes: { drupal_internal__nid: nid, title, created } })

describe('the summary of a rebuild', () => {
  it('is empty of changes when only UUIDs and install times differ', () => {
    const from = build({ 'manifest.json': manifest('11.4.6', {}), 'index/en.json': { links: { 'node--page': {} } }, 'resources/en/node--page.json.gz': [page('3f0c2a8e-6b1d-4c7e-9a52-1d2e3f4a5b6c', 1, 'About', '2026-01-01')] })
    const to = build({ 'manifest.json': manifest('11.4.6', {}), 'index/en.json': { links: { 'node--page': {} } }, 'resources/en/node--page.json.gz': [page('8d9e0f1a-2b3c-4d5e-8f60-718293a4b5c6', 1, 'About', '2026-11-04')] })
    expect(summarise(from, to)).toBe('## Drupal\n\nNo change.\n\n## Index\n\nNo change.\n\n## Resources\n\nNo change.\n\n## Recorded routes\n\nNo change.\n\n## Visitor access\n\nNo change.\n')
  })

  it('names the versions, the index types and the entities that changed', () => {
    const from = build({
      'manifest.json': manifest('11.4.6', { graphql: '4.14.0', simple_oauth: '6.1.1' }),
      'index/en.json': { links: { 'node--page': {}, 'graphql_server--graphql_server': {} } },
      'resources/en/user--user.json.gz': [user('u1', 10, 'editor', 'x'), user('u2', 11, 'author', 'x')],
      'resources/en/graphql_server--graphql_server.json.gz': [{ type: 'graphql_server--graphql_server', id: 'g', attributes: { drupal_internal__id: 'compose' } }],
      'access/en.json.gz': { 'node--page': { visible: ['a'] } },
    })
    const to = build({
      'manifest.json': manifest('11.4.11', { simple_oauth: '6.1.3', decoupled_settings: '1.0.0' }),
      'index/en.json': { links: { 'node--page': {}, 'menu--menu': {} } },
      'resources/en/user--user.json.gz': [user('v1', 10, 'author', 'y'), user('v3', 12, 'reader', 'y')],
      'resources/en/menu--menu.json.gz': [{ type: 'menu--menu', id: 'm', attributes: { drupal_internal__id: 'main' } }],
      'access/en.json.gz': { 'node--page': { visible: [] } },
    })
    const summary = summarise(from, to)
    expect(summary).toContain('- Core 11.4.6 to 11.4.11')
    expect(summary).toContain('- Added decoupled_settings 1.0.0')
    expect(summary).toContain('- Removed graphql')
    expect(summary).toContain('- Updated simple_oauth 6.1.1 to 6.1.3')
    expect(summary).toContain('- en: added `menu--menu`')
    expect(summary).toContain('- en: removed `graphql_server--graphql_server`')
    expect(summary).toContain('| `graphql_server--graphql_server` | gone, was 1 |')
    expect(summary).toContain('| `menu--menu` | new, 1 |')
    expect(summary).toContain('| `user--user` | 2 to 2: 1 added, 1 removed, 1 changed (`name`) |')
    expect(summary).toContain('- `user--user`, en: added 12 (reader). removed 11 (author). changed 10 (author) from 10 (editor)')
    expect(summary).toContain('- en: what a visitor may read changed for `node--page`')
  })

  it('gives the status changes by name, and the rest as counts, with themed pages set aside', () => {
    const routes = (status: number, body: unknown, css: string) => ({ 'GET /a': { status, headers: {}, body }, 'GET /page': { status: 404, headers: {}, body: `<html><link href="${css}">` }, 'GET /same': { status: 200, headers: {}, body: { b: 1 } } })
    const from = build({ 'manifest.json': manifest('11', {}), 'recorded/routes.json.gz': { ...routes(200, { a: 1 }, 'one.css'), 'GET /gone': { status: 200, headers: {}, body: {} } } })
    const to = build({ 'manifest.json': manifest('11', {}), 'recorded/routes.json.gz': { ...routes(403, { a: 2 }, 'two.css'), 'GET /new': { status: 200, headers: {}, body: {} }, 'GET /same': { status: 200, headers: {}, body: { b: 2 } } } })
    const summary = summarise(from, to)
    expect(summary).toContain('- 1 added: `GET /new`')
    expect(summary).toContain('- 1 removed: `GET /gone`')
    expect(summary).toContain('- `GET /a`: 200 to 403')
    expect(summary).toContain('- 1 of 4 answer with the same status and a different body: `GET /same`')
    expect(summary).not.toContain('GET /page')
  })

  it('cuts a long list to what a reader takes in', () => {
    const many = (prefix: string) => Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`${prefix}-${index}--x`, {}]))
    const summary = summarise(build({ 'manifest.json': manifest('11', {}), 'index/en.json': { links: {} } }), build({ 'manifest.json': manifest('11', {}), 'index/en.json': { links: many('type') } }))
    expect(summary).toContain('and 4 more')
  })

  it('compares the recordings when it has them: the reads as routes, and the write scripts by status', () => {
    const dump = build({ 'manifest.json': manifest('11', {}) })
    const scripts = (statuses: number[], name = 'a visitor writes') => [{ name, as: 'anonymous', steps: [], answers: statuses.map((status) => ({ status, headers: {}, body: {} })) }]
    const from = build({ 'reads.json.gz': [{ request: '/x', status: 200, body: {} }], 'writes.json.gz': [...scripts([422, 200]), ...scripts([200], 'gone')] })
    const to = build({ 'reads.json.gz': [{ request: '/x', status: 404, body: {} }], 'writes.json.gz': [...scripts([422, 201]), ...scripts([200], 'new')] })
    const summary = summarise(dump, dump, { from, to })
    expect(summary).toContain('## Oracle reads\n\n- `GET /x`: 200 to 404')
    expect(summary).toContain('- "a visitor writes": 422 200 to 422 201')
    expect(summary).toContain('- New script "new": 200')
    expect(summary).toContain('- Script "gone" is gone')
  })
})

describe('the page beside a rebuilt preset', () => {
  it('names the preset, says how it is written, and puts the summary under its title', async () => {
    const { rebuildPage } = await import('../src/rebuild-summary')
    const page = rebuildPage('umami', '## Drupal\n\n- Core 11.4.6 to 11.4.11\n')
    expect(page.startsWith('# The umami rebuild\n')).toBe(true)
    expect(page).toContain('`yarn rebuild:summary --write`')
    expect(page).toContain('\n## Drupal\n\n- Core 11.4.6 to 11.4.11\n')
  })
})
