import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type PatchList = Record<string, string> | Array<string | { description?: string, url?: string }>
export interface ComposerJson { extra?: { patches?: Record<string, PatchList>, 'patches-file'?: string } }

/**
 * The patches a site applies, by module, as composer-patches 1 and 2 declare them: in `extra.patches` or a patches
 * file (`extra.patches-file`, or 2's default `patches.json`), each as `{ description: url }` or a list of
 * `{ description, url }`.
 *
 * @param dir - The site's composer directory.
 * @param json - Its composer.json.
 * @returns The patch descriptions by module, without the `drupal/` vendor.
 */
export const composerPatches = (dir: string, json: ComposerJson): Record<string, string[]> => {
  const file = join(dir, json.extra?.['patches-file'] || 'patches.json')
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { patches?: Record<string, PatchList> }).patches || {} : {}
  const out: Record<string, string[]> = {}
  for (const declared of [json.extra?.patches || {}, fromFile]) {
    for (const [name, list] of Object.entries(declared)) {
      const names = Array.isArray(list) ? list.map((item) => (typeof item === 'string' ? item : item.description || item.url || '')) : Object.keys(list)
      const key = name.replace(/^drupal\//, '')
      out[key] = [...(out[key] || []), ...names.filter(Boolean)]
    }
  }
  return out
}
