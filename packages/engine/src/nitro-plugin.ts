import { useRuntimeConfig, useStorage } from 'nitropack/runtime'
import { engine, urlOf } from './nitro.js'

/**
 * Answers every server-side `fetch` to the mock's origin from the engine, so a site whose `baseUrl` is that origin
 * reads the preset in process, with no server to reach.
 */
export default (): void => {
  const original = globalThis.fetch
  const { origin } = useRuntimeConfig().decoupledDrupalMock || { origin: 'http://drupal.mock' }
  globalThis.fetch = async (input, init) => {
    const url = urlOf(input as string | URL | Request)
    if (url === origin || url.startsWith(`${origin}/`)) return (await engine({ useRuntimeConfig, useStorage })).fetch(input, init)
    return original(input, init)
  }
}
