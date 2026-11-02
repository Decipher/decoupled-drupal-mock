import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * The build directory a preset names: a directory on disk, a preset package, or a package's short name (`umami`).
 *
 * @param target - The directory or the package.
 * @param from - The directory the package is looked up from.
 * @returns The directory.
 * @throws {Error} When nothing is there, with a message that names what was wrong.
 */
export const presetDir = (target: string, from = process.cwd()): string => {
  if (existsSync(target)) return target
  // A path that is not there is a mistake to name, not a package to look for.
  const isPackage = !target.startsWith('.') && !target.startsWith('/') && (target.startsWith('@') ? target.split('/').length === 2 : !target.includes('/'))
  const candidates = !isPackage ? [] : target.includes('-') || target.startsWith('@') ? [target] : [`decoupled-drupal-mock-${target}`, target]
  const require = createRequire(join(from, 'noop.js'))
  for (const candidate of candidates) {
    try {
      return join(dirname(require.resolve(`${candidate}/package.json`)), 'dump')
    } catch {
      // A package whose exports leave out its package.json is still found where Node looks for it.
      const found = (require.resolve.paths(candidate) || []).map((path) => join(path, candidate)).find((root) => existsSync(join(root, 'package.json')))
      if (found) return join(found, 'dump')
    }
  }
  throw new Error(`${target} is ${isPackage ? 'not an installed preset package' : 'not a directory'}. Name a preset package or a build directory holding manifest.json.`)
}
