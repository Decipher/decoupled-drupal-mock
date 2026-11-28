import { describe, expect, it } from 'vitest'
import { bannerLines } from '../src/banner'
import { dump } from './dump'

describe('what serve prints under the line that says where it listens', () => {
  it('lists the index under each language, the router, the main menu, the token endpoint and the accounts', () => {
    expect(bannerLines(dump, 'http://127.0.0.1:3005')).toEqual([
      '  JSON:API (en)     http://127.0.0.1:3005/jsonapi',
      '  JSON:API (es)     http://127.0.0.1:3005/es/jsonapi',
      '  Decoupled Router  http://127.0.0.1:3005/router/translate-path?path=/',
      '  Main menu         http://127.0.0.1:3005/jsonapi/menu_items/main',
      '  OAuth token       http://127.0.0.1:3005/oauth/token',
      `  Accounts          ${dump.identities!.accounts.map((account) => account.name).join(', ')}`,
    ])
  })

  it('names only what the preset recorded, under the base URL it is given', () => {
    const { identities: _identities, ...rest } = dump
    const bare = { ...rest, manifest: { ...dump.manifest, languages: { en: '' }, drupal: { ...dump.manifest.drupal, modules: {} } }, recorded: {} }
    expect(bannerLines(bare, 'https://mock.example.com')).toEqual(['  JSON:API (en)  https://mock.example.com/jsonapi'])
  })

  it('leaves out the accounts when the preset signs in none', () => {
    const lines = bannerLines({ ...dump, identities: { ...dump.identities!, accounts: [] } }, 'http://127.0.0.1:3005')
    expect(lines.at(-1)).toContain('OAuth token')
  })

  it('dims the labels for a terminal', () => {
    expect(bannerLines(dump, 'http://127.0.0.1:3005', true)[0]).toBe('  \x1b[2mJSON:API (en)   \x1b[22m  http://127.0.0.1:3005/jsonapi')
  })
})
