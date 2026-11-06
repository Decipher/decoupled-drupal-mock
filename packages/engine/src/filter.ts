import { hasOwn, own } from './own.js'
import type { Resource } from './types.js'

export interface Condition { path: string, operator: string, value: unknown, memberOf: string }
export interface Group { conjunction: 'AND' | 'OR', memberOf: string }
export interface Filter { conditions: Record<string, Condition>, groups: Record<string, Group> }

export class FilterError extends Error {}

const OPERATORS = new Set(['=', '<>', '>', '>=', '<', '<=', 'STARTS_WITH', 'CONTAINS', 'ENDS_WITH', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN', 'IS NULL', 'IS NOT NULL'])

/**
 * Drupal's filter forms: `filter[path]=value`, `filter[name][value]=v` with `[path]` and `[operator]`,
 * `filter[name][condition][path|operator|value|memberOf]`, and `filter[name][group][conjunction]`.
 */
export const parseFilter = (filter: unknown): Filter => {
  const out: Filter = { conditions: {}, groups: {} }
  if (!filter || typeof filter !== 'object') return out
  for (const [name, raw] of Object.entries(filter as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      out.conditions[name] = { path: name, operator: '=', value: raw, memberOf: '@root' }
      continue
    }
    const entry = raw as Record<string, unknown>
    if (entry.group && typeof entry.group === 'object') {
      const group = entry.group as Record<string, unknown>
      const conjunction = String(group.conjunction || 'AND').toUpperCase()
      if (conjunction !== 'AND' && conjunction !== 'OR') throw new FilterError(`The conjunction of group "${name}" must be AND or OR.`)
      if (name === '@root') throw new FilterError('Filter parameter is invalid: "@root" is the root group, not a name a group may take.')
      out.groups[name] = { conjunction, memberOf: String(group.memberOf || '@root') }
      continue
    }
    const condition = (entry.condition && typeof entry.condition === 'object' ? entry.condition : entry) as Record<string, unknown>
    const path = String(condition.path ?? name)
    const operator = String(condition.operator ?? '=').toUpperCase().replace(/\s+/g, ' ')
    if (!OPERATORS.has(operator)) throw new FilterError(`The "${operator}" operator is not allowed. Allowed operators are: ${[...OPERATORS].join(', ')}.`)
    const value = condition.value
    if (value === undefined && !['IS NULL', 'IS NOT NULL'].includes(operator)) throw new FilterError(`Filter parameter is invalid: the condition "${name}" needs a value.`)
    out.conditions[name] = { path, operator, value: value === undefined ? null : value, memberOf: String(condition.memberOf || '@root') }
  }
  return out
}

/** Reads a resource at a path such as `title`, `settings.provider`, `uid.meta.drupal_internal__target_id` or `uid.name`. */
export type Reader = (resource: Resource, path: string[]) => unknown[]

/** A path's values on a resource: attributes, nested properties, relationship identifiers, and across a relationship. */
export const createReader = (related: (identifier: { type: string, id: string }) => Resource | undefined): Reader => {
  const read: Reader = (resource, path) => {
    const [head, ...rest] = path
    if (head === undefined) return [resource]
    if (head === 'id' || head === 'type') return [resource[head]]
    if (resource.attributes && hasOwn(resource.attributes, head)) return dig(resource.attributes[head], rest)
    const relationship = own(resource.relationships, head)
    if (relationship) {
      const identifiers = Array.isArray(relationship.data) ? relationship.data : relationship.data ? [relationship.data] : []
      if (!rest.length) return identifiers.map((identifier) => identifier.id)
      if (rest[0] === 'id') return identifiers.map((identifier) => identifier.id)
      if (rest[0] === 'meta') return identifiers.flatMap((identifier) => dig(identifier.meta, rest.slice(1)))
      return identifiers.flatMap((identifier) => {
        const target = related(identifier)
        return target ? read(target, rest) : []
      })
    }
    return []
  }
  return read
}

/** The values at a nested property path, into arrays, as Drupal's entity query matches any delta. */
const dig = (value: unknown, path: string[]): unknown[] => {
  if (!path.length) return Array.isArray(value) ? value : [value]
  const [head, ...rest] = path
  if (Array.isArray(value)) return value.flatMap((item) => dig(item, path))
  if (value && typeof value === 'object' && head !== undefined && hasOwn(value as object, head)) return dig((value as Record<string, unknown>)[head], rest)
  return []
}

const asNumberOrString = (value: unknown): number | string => {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return value
  const text = String(value)
  return text !== '' && !Number.isNaN(Number(text)) ? Number(text) : text
}

/** PHP's (bool) cast of a query value, which Drupal applies to a boolean field's condition. */
export const phpBool = (value: unknown): boolean => !(value === '' || value === '0' || value === 0 || value === false || value === null || value === undefined)

export const compare = (a: unknown, b: unknown): number => {
  if (typeof a === 'boolean') return Number(a) - Number(phpBool(b))
  // A number field compares as a number, a string field as text: "01" is not 1, as it is not in Drupal's SQL.
  if (typeof a === 'number') { const n = Number(b); return Number.isNaN(n) ? 1 : a - n }
  if (typeof a === 'string') return a < String(b) ? -1 : a > String(b) ? 1 : 0
  const x = asNumberOrString(a)
  const y = asNumberOrString(b)
  if (typeof x === 'number' && typeof y === 'number') return x - y
  return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value as object) : [value])

const matches = (values: unknown[], condition: Condition): boolean => {
  const { operator, value } = condition
  const present = values.filter((item) => item !== null && item !== undefined)
  switch (operator) {
    case 'IS NULL': return present.length === 0
    case 'IS NOT NULL': return present.length > 0
    case '=': return present.some((item) => compare(item, value) === 0)
    // A negation needs a value to negate: a field with none does not match, as a NULL does not in SQL.
    case '<>': return present.length > 0 && !present.some((item) => compare(item, value) === 0)
    case '>': return present.some((item) => compare(item, value) > 0)
    case '>=': return present.some((item) => compare(item, value) >= 0)
    case '<': return present.some((item) => compare(item, value) < 0)
    case '<=': return present.some((item) => compare(item, value) <= 0)
    case 'STARTS_WITH': return present.some((item) => String(item).toLowerCase().startsWith(String(value).toLowerCase()))
    case 'CONTAINS': return present.some((item) => String(item).toLowerCase().includes(String(value).toLowerCase()))
    case 'ENDS_WITH': return present.some((item) => String(item).toLowerCase().endsWith(String(value).toLowerCase()))
    case 'IN': return present.some((item) => list(value).some((wanted) => compare(item, wanted) === 0))
    case 'NOT IN': return present.length > 0 && !present.some((item) => list(value).some((wanted) => compare(item, wanted) === 0))
    case 'BETWEEN': { const [low, high] = list(value); return present.some((item) => compare(item, low) >= 0 && compare(item, high) <= 0) }
    case 'NOT BETWEEN': { const [low, high] = list(value); return present.length > 0 && !present.some((item) => compare(item, low) >= 0 && compare(item, high) <= 0) }
    default: return false
  }
}

/** Whether a resource passes the filter's tree of groups and conditions. */
export const passes = (resource: Resource, filter: Filter, read: Reader): boolean => {
  const visited = new Set<string>()
  const evaluate = (group: string): boolean => {
    // A group that names itself, or a cycle, is evaluated once.
    if (visited.has(group)) return true
    visited.add(group)
    const conjunction = group === '@root' ? 'AND' : filter.groups[group]?.conjunction || 'AND'
    const results = [
      ...Object.values(filter.conditions).filter((condition) => condition.memberOf === group).map((condition) => matches(read(resource, condition.path.split('.')), condition)),
      ...Object.entries(filter.groups).filter(([name, member]) => member.memberOf === group && name !== group).map(([name]) => evaluate(name)),
    ]
    if (!results.length) return true
    return conjunction === 'AND' ? results.every(Boolean) : results.some(Boolean)
  }
  return evaluate('@root')
}
