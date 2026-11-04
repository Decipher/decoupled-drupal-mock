/**
 * A build configuration with each `${NAME}` in its strings read from the environment, so a committed configuration
 * names no machine's paths and holds no secret.
 *
 * @param value - The configuration, as parsed from JSON.
 * @param env - The environment to read.
 * @returns The configuration with every reference replaced.
 * @throws {Error} When a reference names a variable the environment does not set.
 */
export const fromEnvironment = <T>(value: T, env: Record<string, string | undefined> = process.env): T => {
  const missing = new Set<string>()
  const expand = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return item.replace(/\$\{([A-Z0-9_]+)\}/g, (_whole, name: string) => {
        const set = env[name]
        if (set === undefined || set === '') missing.add(name)
        return set || ''
      })
    }
    if (Array.isArray(item)) return item.map(expand)
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, expand(entry)]))
    return item
  }
  const expanded = expand(value) as T
  if (missing.size) throw new Error(`The build configuration reads ${[...missing].sort().join(', ')} from the environment: set ${missing.size === 1 ? 'it' : 'them'}.`)
  return expanded
}
