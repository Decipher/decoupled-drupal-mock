import { fileURLToPath } from 'node:url'
import { loadDump } from 'decoupled-drupal-mock/node'

/** The build directory of this preset. */
export const dir = fileURLToPath(new URL('./dump/', import.meta.url))

/** Reads the preset's dump, verified against its manifest. */
export const load = () => loadDump(dir)

export default load
