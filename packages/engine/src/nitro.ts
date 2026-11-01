import { createDrupal } from './engine.js'
import type { Drupal } from './engine.js'
import { loadDumpFrom } from './load.js'
import { isDrupalPath } from './paths.js'

/** What the module put in the runtime config. */
export interface NitroOptions { origin: string, reset: number }

/** The parts of Nitro's storage and runtime this reads, so nitropack stays the site's. */
interface AssetStorage { getItemRaw: (key: string) => Promise<unknown>, getKeys: () => Promise<string[]> }
interface Runtime { useStorage: (base: string) => AssetStorage, useRuntimeConfig: () => { decoupledDrupalMock?: NitroOptions } }

let instance: Promise<Drupal> | undefined
let timer: ReturnType<typeof setInterval> | undefined

/** The one engine of this server, built from the asset storage on first use and reset on the timer when one is set. */
export const engine = (runtime: Runtime): Promise<Drupal> => {
  if (!instance) {
    const options = runtime.useRuntimeConfig().decoupledDrupalMock || { origin: 'http://drupal.mock', reset: 0 }
    const storage = runtime.useStorage('assets:decoupled-drupal-mock')
    instance = loadDumpFrom(async (file) => {
      const raw = await storage.getItemRaw(file.split('/').join(':'))
      return raw instanceof Uint8Array || typeof raw === 'string' ? raw : raw ? new Uint8Array(raw as ArrayBuffer) : null
    }).then((dump) => {
      const drupal = createDrupal(dump, { baseUrl: options.origin })
      if (options.reset > 0 && !timer) {
        timer = setInterval(() => drupal.reset(), options.reset * 1000)
        timer.unref?.()
      }
      return drupal
    })
  }
  return instance
}

/** The URL of a `fetch` input. */
export const urlOf = (input: string | URL | Request): string => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

/** Whether a request on the site's own origin is one the engine answers. */
export const answers = (drupal: Drupal, pathname: string): boolean => isDrupalPath(pathname, Object.values(drupal.manifest.languages).filter(Boolean))
