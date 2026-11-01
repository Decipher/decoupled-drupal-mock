import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDrupal } from './engine.js'
import { loadDump } from './load.js'
import { urlOf } from './nitro.js'

/**
 * `decoupled-drupal-mock/nuxt`: the engine inside a Nuxt site's own server, so a demo or a documentation sandbox is one
 * Nuxt app with no Drupal behind it.
 *
 * The preset's dump ships as a Nitro server asset. A Nitro plugin answers every server-side `fetch` to `origin` from
 * the engine, so a Druxt site whose `baseUrl` is that origin reads the preset without a network round trip, and a
 * middleware answers the Drupal paths on the site's own origin for the browser and for `curl`. The build's own
 * fetches, such as a Druxt module reading the index for its schemas, are answered the same way, so the module goes
 * before the modules that read Drupal.
 *
 * @example @lang ts
 * export default defineNuxtConfig({
 *   modules: ['decoupled-drupal-mock/nuxt', '@druxt/site'],
 *   decoupledDrupalMock: { preset: 'decoupled-drupal-mock-umami' },
 *   druxt: { baseUrl: 'http://drupal.mock' },
 * })
 */
export interface NuxtModuleOptions {
  /** The preset package, such as `decoupled-drupal-mock-umami`, or a build directory holding `manifest.json`. */
  preset?: string
  /** The origin the engine answers for, on the server. A site's `baseUrl` names it. Default `http://drupal.mock`. */
  origin?: string
  /** Seconds between resets to the preset as built, for a public sandbox. Unset, a write lives until the server restarts. */
  reset?: number
}

/** The part of Nuxt this touches, so Nuxt stays a peer the site brings. */
interface NuxtLike {
  options: {
    decoupledDrupalMock?: NuxtModuleOptions
    druxt?: { baseUrl?: string }
    runtimeConfig: Record<string, unknown>
    nitro: { serverAssets?: Array<{ baseName: string, dir: string }>, plugins?: string[], handlers?: Array<{ route?: string, middleware?: boolean, handler: string }> }
  }
}

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url))

const setup = async (inline: NuxtModuleOptions | undefined, nuxt: NuxtLike): Promise<void> => {
  // The config key's options, under the inline ones.
  const options: NuxtModuleOptions = { ...nuxt.options.decoupledDrupalMock, ...inline }
  const target = options.preset || 'decoupled-drupal-mock-umami'
  // A directory on disk, else a preset package.
  const dir = existsSync(target) ? target : (await import(/* @vite-ignore */ import.meta.resolve(target)) as { dir: string }).dir
  const origin = (options.origin || 'http://drupal.mock').replace(/\/+$/, '')
  // The build's own fetches to the origin, answered from the dump on disk.
  const drupal = createDrupal(loadDump(dir), { baseUrl: origin })
  const original = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = urlOf(input as string | URL | Request)
    return url === origin || url.startsWith(`${origin}/`) ? drupal.fetch(input, init) : original(input, init)
  }
  const nitro = nuxt.options.nitro
  nitro.serverAssets = [...(nitro.serverAssets || []), { baseName: 'decoupled-drupal-mock', dir }]
  nitro.plugins = [...(nitro.plugins || []), here('./nitro-plugin.js')]
  nitro.handlers = [...(nitro.handlers || []), { middleware: true, handler: here('./nitro-handler.js') }]
  nuxt.options.runtimeConfig.decoupledDrupalMock = { origin, reset: options.reset ?? 0 }
  // A Druxt site with no base URL of its own reads the mock.
  if (nuxt.options.druxt && !nuxt.options.druxt.baseUrl) nuxt.options.druxt.baseUrl = origin
}

const module = Object.assign(setup, { meta: { name: 'decoupled-drupal-mock', configKey: 'decoupledDrupalMock' } })
export default module
