import type { Dump, Resource } from './types.js'

/**
 * The resources of a dump with a copy-on-write layer over them: a type is cloned the first time it is written, the
 * dump itself is never changed, and `reset()` drops every write.
 */
export class Store {
  private written = new Map<string, Resource[]>()

  constructor(private readonly dump: Dump) {}

  private key(langcode: string, type: string): string {
    return `${langcode}:${type}`
  }

  /** The resources of a type in a language, written ones included, or none when the dump has no such type. */
  get(langcode: string, type: string): Resource[] | undefined {
    const written = this.written.get(this.key(langcode, type))
    if (written) return written
    return this.dump.resources[langcode]?.[type]
  }

  /** The type's list for writing: cloned from the dump the first time. */
  private writable(langcode: string, type: string): Resource[] {
    const key = this.key(langcode, type)
    let list = this.written.get(key)
    if (!list) {
      list = (this.dump.resources[langcode]?.[type] || []).map((resource) => structuredClone(resource))
      this.written.set(key, list)
    }
    return list
  }

  add(langcode: string, type: string, resource: Resource): void {
    this.writable(langcode, type).push(resource)
  }

  replace(langcode: string, type: string, resource: Resource): void {
    const list = this.writable(langcode, type)
    const index = list.findIndex((item) => item.id === resource.id)
    if (index >= 0) list[index] = resource
    else list.push(resource)
  }

  remove(langcode: string, type: string, id: string): boolean {
    const list = this.writable(langcode, type)
    const index = list.findIndex((item) => item.id === id)
    if (index < 0) return false
    list.splice(index, 1)
    return true
  }

  /** The next internal id for an entity type, past every one the dump and the writes hold. */
  nextId(langcode: string, entityType: string, key: string): number {
    let max = 0
    const types = new Set([...Object.keys(this.dump.resources[langcode] || {}), ...[...this.written.keys()].filter((k) => k.startsWith(`${langcode}:`)).map((k) => k.slice(langcode.length + 1))])
    for (const type of types) {
      if (type.split('--')[0] !== entityType) continue
      for (const resource of this.get(langcode, type) || []) {
        const value = Number((resource.attributes as Record<string, unknown> | undefined)?.[key])
        if (Number.isFinite(value) && value > max) max = value
      }
    }
    return max + 1
  }

  reset(): void {
    this.written = new Map()
  }
}
