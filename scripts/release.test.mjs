import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { distTag, missingFromTarball, pendingChangesets, publicPackages, releaseNotes, unreleased } from './release.mjs'

const root = join(import.meta.dirname, '..')

describe('the packages a release publishes', () => {
  it('are the engine and every preset, the engine first, and nothing private', () => {
    expect(publicPackages(root).map(({ name }) => name)).toEqual(['decoupled-drupal-mock', 'decoupled-drupal-mock-dashi', 'decoupled-drupal-mock-haven', 'decoupled-drupal-mock-umami'])
  })

  it('put a package another depends on first, whatever its directory or name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ddm-order-'))
    const write = (path, manifest) => {
      mkdirSync(join(dir, path), { recursive: true })
      writeFileSync(join(dir, path, 'package.json'), JSON.stringify({ version: '1.0.0', ...manifest }))
    }
    write('packages/zz-engine', { name: 'zz' })
    write('packages/aa-helper', { name: 'aa', peerDependencies: { zz: '^1.0.0' } })
    write('presets/mm', { name: 'mm', dependencies: { aa: '^1.0.0' } })
    write('packages/private', { name: 'private', private: true })
    expect(publicPackages(dir).map(({ name }) => name)).toEqual(['zz', 'aa', 'mm'])
  })

  it('share one version, since the changesets config releases them together', () => {
    expect(new Set(publicPackages(root).map(({ version }) => version)).size).toBe(1)
  })
})

describe('what waits for the version pull request', () => {
  const repository = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'ddm-release-'))
    mkdirSync(join(dir, '.changeset'))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, '.changeset', name), text)
    return dir
  }

  it('is each changeset, and not the README or the config', () => {
    expect(pendingChangesets(repository({ 'README.md': '', 'config.json': '{}', 'a.md': '---\n---\n', 'b.md': '---\n---\n' }))).toBe(2)
  })

  it('includes leaving prerelease mode, which versions the packages with no changeset of its own', () => {
    expect(pendingChangesets(repository({ 'pre.json': '{"mode":"exit","tag":"alpha"}' }))).toBe(1)
    expect(pendingChangesets(repository({ 'pre.json': '{"mode":"pre","tag":"alpha"}' }))).toBe(0)
  })
})

describe('a version\'s dist-tag', () => {
  it('is the prerelease\'s name for a prerelease, and latest otherwise', () => {
    expect(distTag('1.0.0-alpha.4')).toBe('alpha')
    expect(distTag('1.0.0-beta.1+build.7')).toBe('beta')
    expect(distTag('1.0.0-rc.0')).toBe('rc')
    expect(distTag('1.0.0')).toBe('latest')
    expect(distTag('1.2.3+build.7')).toBe('latest')
  })
})

describe('the release notes', () => {
  const changelog = '# decoupled-drupal-mock\n\n## 1.0.0-alpha.4\n\n### Minor Changes\n\n- Background server.\n\n## 1.0.0-alpha.3\n\n- Older.\n'

  it('are the version\'s section, without its heading or the next one', () => {
    expect(releaseNotes(changelog, '1.0.0-alpha.4')).toBe('### Minor Changes\n\n- Background server.\n')
    expect(releaseNotes(changelog, '1.0.0-alpha.3')).toBe('- Older.\n')
  })

  it('are empty for a version the changelog does not have, rather than another version\'s', () => {
    expect(releaseNotes(changelog, '1.0.0-alpha')).toBe('')
  })
})

describe('the versions not released yet', () => {
  const packages = [{ name: 'a', version: '1.0.0' }, { name: 'b', version: '1.0.0' }, { name: 'c', version: '1.0.0' }]

  it('are those npm lacks, and those on npm whose GitHub Release is missing', () => {
    const onNpm = (spec) => spec !== 'a@1.0.0'
    const hasRelease = (tag) => tag !== 'b@1.0.0'
    expect(unreleased(packages, { onNpm, hasRelease })).toEqual([
      { name: 'a', version: '1.0.0', published: false },
      { name: 'b', version: '1.0.0', published: true },
    ])
  })

  it('are none once every version is on npm with its Release', () => {
    expect(unreleased(packages, { onNpm: () => true, hasRelease: () => true })).toEqual([])
  })
})

describe('a packed tarball', () => {
  const manifest = { bin: 'bin.js', exports: { '.': { types: './index.d.ts', import: './index.js' }, './package.json': './package.json' }, files: ['bin.js', 'index.js', 'index.d.ts', 'dump'] }

  it('lacks nothing when it holds every bin, export and file entry', () => {
    const entries = ['package/package.json', 'package/bin.js', 'package/index.js', 'package/index.d.ts', 'package/dump/manifest.json']
    expect(missingFromTarball(manifest, entries)).toEqual([])
  })

  it('names what it lacks, such as a dump that was not packed', () => {
    expect(missingFromTarball(manifest, ['package/package.json', 'package/bin.js', 'package/index.js'])).toEqual(['index.d.ts', 'dump'])
  })
})
