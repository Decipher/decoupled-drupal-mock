import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Where a build's recordings are: `oracle/` beside a preset's `dump/`, or `<out>.oracle` for any other build.
 *
 * @param dir - The dump directory.
 * @returns The recordings' directory.
 */
export const oracleDir = (dir: string): string => {
  const own = `${dir.replace(/\/+$/, '')}.oracle`
  return existsSync(own) ? own : join(dirname(dir.replace(/\/+$/, '')), 'oracle')
}
