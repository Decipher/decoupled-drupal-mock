import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isDrupalPath } from '../src/paths.ts'
import { loadDump, loadDumpFrom } from '../src/load.ts'
import nuxtModule from '../src/nuxt.ts'

const dir = fileURLToPath(new URL('../../../presets/umami/dump', import.meta.url))

describe('the paths Drupal answers', () => {
  it('names JSON:API, the router, OAuth, the session and the menus, under a language prefix or none', () => {
    for (const path of ['/jsonapi', '/jsonapi/node/recipe', '/en/jsonapi', '/es/router/translate-path', '/oauth/token', '/session/token', '/en/system/menu/main/linkset', '/user/login', '/user/logout']) expect(isDrupalPath(path, ['en', 'es']), path).toBe(true)
    for (const path of ['/', '/en', '/en/recipes', '/jsonapix', '/fr/jsonapi', '/user/1', '/_nuxt/entry.js']) expect(isDrupalPath(path, ['en', 'es']), path).toBe(false)
  })
})

describe('a dump from a reader', () => {
  it('assembles what loadDump assembles, from bytes handed to it', async () => {
    const dump = await loadDumpFrom(async (file) => readFileSync(join(dir, file)))
    const direct = loadDump(dir)
    expect(dump.manifest).toEqual(direct.manifest)
    expect(Object.keys(dump.resources.en!)).toEqual(Object.keys(direct.resources.en!))
    expect(dump.resources.en!['node--recipe']).toHaveLength(direct.resources.en!['node--recipe']!.length)
    expect(Object.keys(dump.recorded)).toHaveLength(Object.keys(direct.recorded).length)
    expect(dump.identities?.accounts.map((account) => account.name)).toEqual(direct.identities?.accounts.map((account) => account.name))
  })

  it('names the file a manifest lists but the reader lacks', async () => {
    await expect(loadDumpFrom(async (file) => (file === 'manifest.json' ? readFileSync(join(dir, file)) : null))).rejects.toThrow(/is in the manifest of umami but was not found/)
  })
})

describe('the Nuxt module', () => {
  const original = globalThis.fetch
  afterEach(() => { globalThis.fetch = original })

  it('ships the dump as a server asset, registers the plugin and the middleware, and answers the build\'s fetches', async () => {
    const nuxt = { options: { decoupledDrupalMock: { preset: dir, reset: 60 }, druxt: {} as { baseUrl?: string }, runtimeConfig: {} as Record<string, unknown>, nitro: {} as { serverAssets?: Array<{ baseName: string, dir: string }>, plugins?: string[], handlers?: Array<{ middleware?: boolean, handler: string }> } } }
    await nuxtModule(undefined, nuxt)
    expect(nuxt.options.nitro.serverAssets).toEqual([{ baseName: 'decoupled-drupal-mock', dir }])
    expect(nuxt.options.nitro.plugins![0]).toMatch(/nitro-plugin\.js$/)
    expect(nuxt.options.nitro.handlers![0]).toMatchObject({ middleware: true, handler: expect.stringMatching(/nitro-handler\.js$/) })
    expect(nuxt.options.runtimeConfig.decoupledDrupalMock).toEqual({ origin: 'http://drupal.mock', reset: 60 })
    expect(nuxt.options.druxt.baseUrl).toBe('http://drupal.mock')
    // The build's own fetch to the origin is answered from the dump; any other goes where it went.
    const index = await (await globalThis.fetch('http://drupal.mock/jsonapi')).json() as { links: Record<string, { href: string }> }
    expect(index.links['node--recipe']!.href).toBe('http://drupal.mock/en/jsonapi/node/recipe')
    expect(nuxtModule.meta).toEqual({ name: 'decoupled-drupal-mock', configKey: 'decoupledDrupalMock' })
  })

  it('keeps a base URL the site set', async () => {
    const nuxt = { options: { druxt: { baseUrl: 'https://cms.example.com' }, decoupledDrupalMock: { preset: dir, origin: 'http://cms.mock/' }, runtimeConfig: {} as Record<string, unknown>, nitro: {} } }
    await nuxtModule(undefined, nuxt)
    expect(nuxt.options.druxt.baseUrl).toBe('https://cms.example.com')
    expect(nuxt.options.runtimeConfig.decoupledDrupalMock).toEqual({ origin: 'http://cms.mock', reset: 0 })
  })
})
