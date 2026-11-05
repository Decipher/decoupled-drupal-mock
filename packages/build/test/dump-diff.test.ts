import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('reads recordings on one side only against none on the other', () => {
    const dump = build({ 'manifest.json': manifest('11', {}) })
    const to = build({ 'reads.json.gz': [{ request: '/x', status: 200, body: {} }], 'writes.json.gz': [{ name: 'first', as: 'anonymous', steps: [], answers: [{ status: 201, headers: {}, body: {} }] }] })
    const summary = summarise(dump, dump, { to })
    expect(summary).toContain('## Oracle reads\n\n- 1 added: `GET /x`')
    expect(summary).toContain('- New script "first": 201')
  })

  it('names a change of default language, and an index link that moved', () => {
    const from = build({ 'manifest.json': manifest('11', {}), 'index/en.json': { links: { 'node--page': { href: 'https://drupal.invalid/jsonapi/node/page' } } } })
    const to = build({ 'manifest.json': { ...manifest('11', {}), defaultLanguage: 'es' }, 'index/en.json': { links: { 'node--page': { href: 'https://drupal.invalid/jsonapi/pages' } } } })
    const summary = summarise(from, to)
    expect(summary).toContain('- Default language en to es')
    expect(summary).toContain('- en: links somewhere else for `node--page`')
  })

  it('reads only the recordings in a resources directory', () => {
    const files = { 'manifest.json': manifest('11', {}), 'resources/en/node--page.json.gz': [page('a', 1, 'About', 'x')], 'resources/en/.DS_Store': '' }
    expect(summarise(build(files), build(files))).toContain('## Resources\n\nNo change.')
  })

  it('refuses a dump after that is not a build, and summarises one with no build before it', () => {
    const to = build({ 'manifest.json': manifest('11.4.11', {}), 'resources/en/node--page.json.gz': [page('a', 1, 'About', 'x')] })
    expect(() => summarise(to, build({}))).toThrow('has no manifest.json: it is not a finished build.')
    const summary = summarise(join(to, 'missing'), to)
    expect(summary).toContain('- No build before this one. Core 11.4.11, profile demo_umami')
    expect(summary).toContain('| `node--page` | new, 1 |')
  })
})

describe('the pages beside the presets', () => {
  // A hook runs the tests with GIT_DIR set, and git would take it for the repository each test makes.
  const repository = (): { root: string, git: (...args: string[]) => string } => {
    const root = mkdtempSync(join(tmpdir(), 'rebuild-summary-'))
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' })
    git('init', '--quiet', '--initial-branch=main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    writeFileSync(join(root, 'README.md'), '')
    git('add', '.')
    git('commit', '--quiet', '-m', 'first')
    return { root, git }
  }
  const preset = (root: string, core: string): void => {
    mkdirSync(join(root, 'presets', 'p', 'dump'), { recursive: true })
    writeFileSync(join(root, 'presets', 'p', 'dump', 'manifest.json'), JSON.stringify(manifest(core, {})))
  }
  const withoutGit = <T>(run: () => T): T => {
    const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('GIT_')))
    for (const name of Object.keys(saved)) delete process.env[name]
    try {
      return run()
    } finally {
      Object.assign(process.env, saved)
    }
  }

  it('writes the page for a preset the base does not have yet, and then holds the recordings to it', async () => {
    const { rebuildSummaries } = await import('../src/rebuild-summary')
    const { root, git } = repository()
    const base = git('rev-parse', 'HEAD').trim()
    preset(root, '11.4.11')
    git('add', '.')
    git('commit', '--quiet', '-m', 'preset')
    const log: string[] = []
    expect(withoutGit(() => rebuildSummaries({ base, write: true, root, log: (line) => log.push(line) }))).toBe(true)
    expect(log).toEqual(['p: wrote presets/p/REBUILD.md'])
    expect(readFileSync(join(root, 'presets', 'p', 'REBUILD.md'), 'utf8')).toContain('- No build before this one. Core 11.4.11, profile demo_umami')
    expect(withoutGit(() => rebuildSummaries({ base, write: false, root, log: () => {} }))).toBe(true)
  })

  it('writes the page for recordings not yet staged, which git diff does not see', async () => {
    const { rebuildSummaries } = await import('../src/rebuild-summary')
    const { root, git } = repository()
    const base = git('rev-parse', 'HEAD').trim()
    preset(root, '11.4.11')
    const log: string[] = []
    expect(withoutGit(() => rebuildSummaries({ base, write: true, root, log: (line) => log.push(line) }))).toBe(true)
    expect(log).toEqual(['p: wrote presets/p/REBUILD.md'])
  })

  it('fails when a rebuild leaves recordings with no manifest, rather than skipping the preset', async () => {
    const { rebuildSummaries } = await import('../src/rebuild-summary')
    const { root, git } = repository()
    preset(root, '11.4.11')
    git('add', '.')
    git('commit', '--quiet', '-m', 'preset')
    const base = git('rev-parse', 'HEAD').trim()
    rmSync(join(root, 'presets', 'p', 'dump', 'manifest.json'))
    writeFileSync(join(root, 'presets', 'p', 'dump', 'index.json'), '{}')
    const errors: string[] = []
    expect(withoutGit(() => rebuildSummaries({ base, write: true, root, error: (line) => errors.push(line) }))).toBe(false)
    expect(errors).toEqual(['p: the recordings changed, but presets/p/dump/manifest.json is missing, so they are not a build. Rebuild the preset.'])
    expect(existsSync(join(root, 'presets', 'p', 'REBUILD.md'))).toBe(false)
  })

  it('fails when the committed page does not say what changed, and names the base to write it from', async () => {
    const { rebuildSummaries } = await import('../src/rebuild-summary')
    const { root, git } = repository()
    preset(root, '11.4.10')
    git('add', '.')
    git('commit', '--quiet', '-m', 'preset')
    const base = git('rev-parse', 'HEAD').trim()
    expect(withoutGit(() => rebuildSummaries({ base, write: false, root, log: () => {} }))).toBe(true)
    preset(root, '11.4.11')
    writeFileSync(join(root, 'presets', 'p', 'REBUILD.md'), 'stale\n')
    const errors: string[] = []
    expect(withoutGit(() => rebuildSummaries({ base, write: false, root, error: (line) => errors.push(line) }))).toBe(false)
    expect(errors[0]).toContain(`Run \`yarn rebuild:summary ${base} --write\``)
    expect(errors[0]).toContain('- Core 11.4.10 to 11.4.11')
  })

  it('refuses a base that is not a commit, so git never reads it as an option', async () => {
    const { rebuildSummaries } = await import('../src/rebuild-summary')
    const { root, git } = repository()
    preset(root, '11.4.11')
    git('add', '.')
    git('commit', '--quiet', '-m', 'preset')
    const written = join(root, 'written')
    expect(() => withoutGit(() => rebuildSummaries({ base: `--output=${written}`, write: false, root, log: () => {} })))
      .toThrow(`--output=${written} is not a commit in this repository.`)
    expect(existsSync(written)).toBe(false)
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
