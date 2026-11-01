import { getRequestURL, toWebRequest } from 'h3'
import { useRuntimeConfig, useStorage } from 'nitropack/runtime'
import { answers, engine } from './nitro.js'

/** Answers the Drupal paths on the site's own origin, for the browser and for `curl`; every other path passes. */
export default async (event: Parameters<typeof toWebRequest>[0]): Promise<Response | undefined> => {
  const url = getRequestURL(event)
  const drupal = await engine({ useRuntimeConfig, useStorage })
  if (!answers(drupal, url.pathname)) return undefined
  return drupal.fetch(toWebRequest(event))
}
