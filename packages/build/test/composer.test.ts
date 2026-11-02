import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composerPatches } from '../src/composer'

const site = (files: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'composer-'))
  for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), JSON.stringify(body))
  return dir
}

describe('the patches a site applies', () => {
  it('reads composer-patches 1: inline, by description', () => {
    const json = { extra: { patches: { 'drupal/decoupled_router': { 'Language prefixes #3111456': 'https://example.org/a.patch' } } } }
    expect(composerPatches(site({}), json)).toEqual({ decoupled_router: ['Language prefixes #3111456'] })
  })

  it('reads a patches file, named or composer-patches 2\'s default, and the list form', () => {
    const named = site({ 'my-patches.json': { patches: { 'drupal/druxt': { 'Router #3273228': 'https://example.org/b.patch' } } } })
    expect(composerPatches(named, { extra: { 'patches-file': 'my-patches.json' } })).toEqual({ druxt: ['Router #3273228'] })
    const v2 = site({ 'patches.json': { patches: { 'drupal/core': [{ description: 'A core fix', url: 'https://example.org/c.patch' }, 'https://example.org/d.patch'] } } })
    expect(composerPatches(v2, {})).toEqual({ core: ['A core fix', 'https://example.org/d.patch'] })
  })

  it('has none when none are declared', () => {
    expect(composerPatches(site({}), {})).toEqual({})
  })
})
