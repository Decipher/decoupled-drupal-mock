// The runtime imports a Nuxt site provides. Typed here as far as this uses them, so the packages stay the site's.
declare module 'nitropack/runtime' {
  export const useStorage: (base?: string) => { getItemRaw: (key: string) => Promise<unknown>, getKeys: () => Promise<string[]> }
  export const useRuntimeConfig: () => { decoupledDrupalMock?: { origin: string, reset: number } }
}
declare module 'h3' {
  export interface H3Event { path: string }
  export const getRequestURL: (event: H3Event) => URL
  export const toWebRequest: (event: H3Event) => Request
}
