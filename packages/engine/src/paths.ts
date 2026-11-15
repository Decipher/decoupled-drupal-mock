import type { TypeFilters } from './types.js'

/** What the path check reads of the dump. */
export interface Schema {
  filters: (type: string) => TypeFilters | undefined
  /** A type's field names, or nothing when the dump holds no resource of it to read them from. */
  fields: (type: string) => Set<string> | undefined
  /** The types a relationship reaches, none when it holds no data, or nothing when the field is not a relationship. */
  targets: (type: string, field: string) => Set<string> | undefined
  /** Whether the reader may filter by a field the build found refused to a visitor. */
  all: boolean
}

/** Drupal's answer to a path it will not filter or sort by. */
export interface PathError { status: 400 | 403 | 500, detail: string }

const tick = (name: string): string => `\`${name}\``
const nested = (detail: string): PathError => ({ status: 400, detail: `Invalid nested filtering. ${detail}` })
const missing = (field: string, path: string): PathError => nested(`The field ${tick(field)}, given in the path ${tick(path)}, does not exist.`)
const elided = (property: string, path: string, kept: string, given: string): PathError => nested(`The property ${tick(property)}, given in the path ${tick(path)}, does not exist. Filter by ${tick(kept)}, not ${tick(given)} (the JSON:API module elides property names from single-property fields).`)
const failure = (detail: string): PathError => ({ status: 500, detail })

/**
 * Checks a filter or sort path as JSON:API's field resolver walks it: each field must exist on the types reached so
 * far, the reader must be allowed to filter by it, and its last part must be one Drupal resolves. What Drupal decides
 * per site comes from the build's probes. The grammar around it is the resolver's own.
 *
 * @param schema - What the dump knows of the types.
 * @param type - The collection's resource type.
 * @param path - The path, such as `uid.entity:user.name`.
 * @returns Drupal's error, or nothing when Drupal resolves the path.
 */
export const checkPath = (schema: Schema, type: string, path: string): PathError | undefined => {
  const segments = path.split('.')
  const filtersOf = (types: Set<string>) => [...types].map((current) => schema.filters(current))
  const known = (types: Set<string>, field: string): boolean | undefined => {
    const sets = [...types].map((current) => schema.fields(current))
    if (sets.some((set) => set === undefined)) return undefined
    if (filtersOf(types).every((filters) => filters?.missing?.includes(field))) return false
    return field === 'id' || field === 'type' || sets.some((set) => set!.has(field))
  }
  if (schema.filters(type)?.config) {
    const [head] = segments
    if (known(new Set([type]), head!) === false) return missing(head!, path)
    const failed = schema.filters(type)?.failures?.[head!]
    return segments.length === 1 && failed ? failure(failed) : undefined
  }
  let types = new Set([type])
  const named: string[] = []
  for (let index = 0; index < segments.length; index++) {
    const field = segments[index]!
    named.push(field)
    if (known(types, field) === false) return missing(field, path)
    const filters = filtersOf(types)
    if (!schema.all && filters.some((entry) => entry?.refused?.includes(field))) return { status: 403, detail: `The current user is not authorized to filter by the ${tick(field)} field, given in the path ${tick(named.join('.'))}.` }
    const specifiers = filters.find((entry) => entry?.specifiers?.[field])?.specifiers?.[field]
    const failures = Object.assign({}, ...filters.map((entry) => entry?.failures || {})) as Record<string, string>
    const rest = segments.slice(index + 1)
    const targets = [...types].map((current) => schema.targets(current, field)).find(Boolean)
    if (!rest.length) {
      if (failures[field]) return failure(failures[field])
      if (specifiers) return nested(`The field ${tick(field)}, given in the path ${tick(path)} is incomplete, it must end with one of the following specifiers: ${specifiers.map(tick).join(', ')}.`)
      return undefined
    }
    const [next, ...after] = rest as [string, ...string[]]
    if (targets) {
      if (next === 'id') return after.length ? elided(after[0]!, path, segments.slice(0, index + 2).join('.'), segments.slice(0, index + 3).join('.')) : undefined
      if (next === 'meta') {
        if (!after.length) return undefined
        const [property, ...beyond] = after as [string, ...string[]]
        if (property !== 'drupal_internal__target_id' && !specifiers?.includes(`meta.${property}`)) return missing(property, path)
        if (failures[`${field}.meta.${property}`]) return failure(failures[`${field}.meta.${property}`]!)
        return beyond.length ? failure(`Invalid specifier '${beyond[0]}'`) : undefined
      }
      // A relationship the dump holds no target of reaches types nothing can be known of.
      if (!targets.size) return undefined
      // Drupal resolves the next field on the types the relationship reaches, whatever type `entity:type` names.
      named.push(...new Set([...targets].map((target) => `entity:${target.split('--')[0]}`)))
      if (/^entity(:.+)?$/.test(next)) {
        if (!after.length) return undefined
        index++
      }
      types = targets
      continue
    }
    if (specifiers) {
      if (!specifiers.includes(next)) return nested(`The property ${tick(next)}, given in the path ${tick(path)}, does not exist. Must be one of the following property names: ${specifiers.map(tick).join(', ')}.`)
      if (failures[`${field}.${next}`]) return failure(failures[`${field}.${next}`]!)
      return after.length ? failure(`Invalid specifier '${after[0]}'`) : undefined
    }
    // A type the build never probed keeps the reading it had before: any property below a field.
    if (!filters.some(Boolean)) return undefined
    return elided(next, path, segments.slice(0, index + 1).join('.'), segments.slice(0, index + 2).join('.'))
  }
  return undefined
}
