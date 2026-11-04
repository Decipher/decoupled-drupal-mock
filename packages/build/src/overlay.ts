import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Document, Recorded, Resource } from 'decoupled-drupal-mock'

/** What a variant of a site answers differently from its baseline, as a build recorded both. */
export interface Overlay {
  name: string
  /** The site this was recorded from, as its manifest names it. */
  drupal: { core: string, modules: Record<string, string>, patches?: Record<string, string[]> }
  recorded: Record<string, Recorded>
  /** Recordings the variant does not have. */
  removed: string[]
  /** The types that differ, whole, by language. */
  resources: Record<string, Record<string, Resource[]>>
  /** The types the variant does not have, by language. */
  removedTypes: Record<string, string[]>
  index: Record<string, Document>
  access: Record<string, unknown>
}

// A file that is not there is undefined. One that is there and cannot be read stops the diff: an overlay written from
// half a build would misstate the variant.
const read = <T>(dir: string, file: string): T | undefined => {
  let bytes: Buffer
  try {
    bytes = readFileSync(join(dir, file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T
  } catch (error) {
    throw new Error(`${join(dir, file)} cannot be read: ${(error as Error).message}`)
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// What names an entity across installs of the same site: its internal id, or its machine name for configuration.
// UUIDs are made fresh by each install, so a site built twice has the same content under other UUIDs.
const STABLE_KEYS = ['drupal_internal__nid', 'drupal_internal__tid', 'drupal_internal__mid', 'drupal_internal__uid', 'drupal_internal__fid', 'drupal_internal__id', 'drupal_internal__name', 'drupal_internal__type', 'drupal_internal__vid', 'drupal_internal__format']
// When an install made or last touched an entity: another install's are its own, and say nothing about the change.
const INSTALL_TIMES = ['created', 'changed', 'revision_created', 'revision_timestamp', 'content_translation_created', 'content_translation_changed', 'access', 'login']

const resourcesOf = (dir: string): Array<[string, Resource]> => {
  const out: Array<[string, Resource]> = []
  let langcodes: string[] = []
  try {
    langcodes = readdirSync(join(dir, 'resources'))
  } catch {
    return out
  }
  for (const langcode of langcodes) {
    for (const file of readdirSync(join(dir, 'resources', langcode))) for (const resource of read<Resource[]>(dir, `resources/${langcode}/${file}`) || []) out.push([langcode, resource])
  }
  return out
}

/** Each entity's UUID in a build, by what names it in any install: `type#id`, from its attributes or from a relationship to it. */
const uuidsByKey = (dir: string): Map<string, string> => {
  const keys = new Map<string, string>()
  const ambiguous = new Set<string>()
  // A key two entities share names neither.
  const name = (key: string, uuid: string): void => {
    if (keys.has(key) && keys.get(key) !== uuid) ambiguous.add(key)
    else keys.set(key, uuid)
  }
  for (const [, resource] of resourcesOf(dir)) {
    const attributes = (resource.attributes || {}) as Record<string, unknown>
    const stable = STABLE_KEYS.find((key) => attributes[key] !== undefined && attributes[key] !== null)
    if (stable) name(`${resource.type}#${String(attributes[stable])}`, resource.id)
    for (const relationship of Object.values(resource.relationships || {}) as Array<{ data?: unknown }>) {
      for (const target of (Array.isArray(relationship.data) ? relationship.data : [relationship.data]) as Array<{ type?: string, id?: string, meta?: { drupal_internal__target_id?: unknown } } | null | undefined>) {
        const id = target?.meta?.drupal_internal__target_id
        if (target?.type && target.id && id !== undefined && id !== null) name(`${target.type}#${String(id)}`, target.id)
      }
    }
  }
  for (const key of ambiguous) keys.delete(key)
  return keys
}

/**
 * A variant built from another install of the baseline's site, read as if it were the baseline's install: each
 * entity under the baseline's UUID, and the baseline's install times. A variant of the same install comes back as it
 * was, bar those times.
 *
 * @param base - The baseline's build directory.
 * @param variant - The variant's build directory.
 * @returns What turns a value read from the variant into the baseline's terms.
 */
export const alignTo = (base: string, variant: string): (value: unknown) => unknown => {
  const from = uuidsByKey(variant)
  const to = uuidsByKey(base)
  const map = new Map<string, string>()
  const taken = new Map<string, number>()
  for (const [key, uuid] of from) {
    const target = to.get(key)
    if (target && target !== uuid) {
      map.set(uuid, target)
      taken.set(target, (taken.get(target) || 0) + 1)
    }
  }
  // Two entities claiming one UUID would merge: neither is mapped.
  for (const [uuid, target] of [...map]) if (taken.get(target)! > 1) map.delete(uuid)
  const times = new Map<string, Record<string, unknown>>()
  for (const [langcode, resource] of resourcesOf(base)) {
    const attributes = (resource.attributes || {}) as Record<string, unknown>
    times.set(`${resource.type} ${resource.id} ${String(attributes.langcode ?? langcode)}`, Object.fromEntries(INSTALL_TIMES.filter((key) => key in attributes).map((key) => [key, attributes[key]])))
  }
  const pattern = map.size ? new RegExp([...map.keys()].join('|'), 'g') : undefined
  const settle = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(settle)
    if (!value || typeof value !== 'object') return value
    const object = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, settle(item)])) as Record<string, unknown>
    const attributes = object.attributes as Record<string, unknown> | undefined
    if (typeof object.type === 'string' && typeof object.id === 'string' && attributes && typeof attributes === 'object') {
      const kept = times.get(`${object.type} ${object.id} ${String(attributes.langcode ?? '')}`)
      if (kept) object.attributes = { ...attributes, ...Object.fromEntries(Object.entries(kept).filter(([key]) => key in attributes)) }
    }
    return object
  }
  return (value) => settle(pattern ? JSON.parse(JSON.stringify(value).replace(pattern, (uuid) => map.get(uuid)!)) : value)
}

// What differs between any two recordings and means nothing: when a user last signed in, and themed error pages.
const noise = (resource: Resource): Resource => {
  if (resource.type !== 'user--user') return resource
  const { access: _access, changed: _changed, ...attributes } = (resource.attributes || {}) as Record<string, unknown>
  return { ...resource, attributes }
}
const quiet = (recording: Recorded | undefined): unknown => {
  if (!recording) return undefined
  const body = typeof recording.body === 'string' && recording.body.startsWith('<') ? '<html>' : recording.body
  // The content type is the one header a recording keeps.
  return { status: recording.status, type: recording.headers?.['content-type'], body }
}

/**
 * The difference between two builds of the same site.
 *
 * @param base - The baseline's build directory.
 * @param variant - The variant's build directory.
 * @param name - What the overlay is called.
 * @returns The overlay.
 */
export const diffBuilds = (base: string, variant: string, name: string): Overlay => {
  const manifest = read<{ drupal: Overlay['drupal'], languages: Record<string, string> }>(variant, 'manifest.json')
  if (!manifest) throw new Error(`${variant} has no manifest.json: it is not a finished build.`)
  const align = alignTo(base, variant)
  const readVariant = <T>(file: string): T | undefined => {
    const value = read<T>(variant, file)
    return value === undefined ? undefined : align(value) as T
  }
  const fromRecorded = read<Record<string, Recorded>>(base, 'recorded/routes.json.gz') || {}
  const toRecordedFile = readVariant<Record<string, Recorded>>('recorded/routes.json.gz')
  // A variant without the recordings its baseline has is a crawl that failed, not a site that answers nothing.
  if (Object.keys(fromRecorded).length && !toRecordedFile) throw new Error(`${variant} has no recorded/routes.json.gz, which ${base} has: build the variant again.`)
  const toRecorded = toRecordedFile || {}
  const overlay: Overlay = { name, drupal: manifest.drupal, recorded: {}, removed: [], resources: {}, removedTypes: {}, index: {}, access: {} }
  for (const [key, recording] of Object.entries(toRecorded)) if (!same(quiet(fromRecorded[key]), quiet(recording))) overlay.recorded[key] = recording
  overlay.removed = Object.keys(fromRecorded).filter((key) => !(key in toRecorded))
  for (const langcode of Object.keys(manifest.languages)) {
    const types = new Set<string>()
    for (const dir of [base, variant]) {
      try {
        for (const file of readdirSync(join(dir, 'resources', langcode))) types.add(file.replace(/\.json\.gz$/, ''))
      } catch {
        // A language with no resources.
      }
    }
    for (const type of types) {
      const from = read<Resource[]>(base, `resources/${langcode}/${type}.json.gz`) || []
      const to = readVariant<Resource[]>(`resources/${langcode}/${type}.json.gz`)
      // A type the variant lacks is gone, not an empty collection.
      if (!to) (overlay.removedTypes[langcode] ||= []).push(type)
      else if (!same(from.map(noise), to.map(noise))) (overlay.resources[langcode] ||= {})[type] = to
    }
    const fromIndex = read<Document>(base, `index/${langcode}.json`)
    const toIndex = readVariant<Document>(`index/${langcode}.json`)
    if (toIndex && !same(fromIndex, toIndex)) overlay.index[langcode] = toIndex
    const fromAccess = read<unknown>(base, `access/${langcode}.json.gz`)
    const toAccess = readVariant<unknown>(`access/${langcode}.json.gz`)
    if (!same(fromAccess, toAccess)) overlay.access[langcode] = toAccess ?? {}
  }
  return overlay
}

const hashInto = (out: string, file: string, bytes: Buffer): void => {
  const manifestFile = join(out, 'manifest.json')
  let manifest: Record<string, string> = {}
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, string>
  } catch {
    // The first overlay written here.
  }
  manifest[file] = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(manifestFile, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`)
}

/**
 * Writes an overlay into a directory of overlays, named with its hash in that directory's `manifest.json`.
 *
 * @param overlay - The overlay.
 * @param out - The directory: `<name>.json.gz` is the overlay.
 */
export const writeOverlay = (overlay: Overlay, out: string): void => {
  mkdirSync(out, { recursive: true })
  const bytes = gzipSync(Buffer.from(JSON.stringify(overlay)), { level: 9 })
  writeFileSync(join(out, `${overlay.name}.json.gz`), bytes)
  hashInto(out, `${overlay.name}.json.gz`, bytes)
}

/**
 * Puts the variant site's real answers beside its overlay, in the baseline's terms as the overlay is, where a test
 * replays them against the baseline plus the overlay. Named with its hash in the directory's manifest, so the bytes
 * replayed are the bytes recorded.
 *
 * @param recording - The variant build's `reads.json.gz` or `writes.json.gz`.
 * @param out - The directory of overlays: the reads are `oracle/<name>.json.gz`, and the writes `oracle/<name>.writes.json.gz`.
 * @param name - The overlay's name.
 * @param align - What the overlay was read through, from `alignTo`.
 * @param kind - Whether the recording holds the reads or the write scripts.
 */
export const publishOverlayRecording = (recording: string, out: string, name: string, align: (value: unknown) => unknown = (value) => value, kind: 'reads' | 'writes' = 'reads'): void => {
  const entries = align(JSON.parse(gunzipSync(readFileSync(recording)).toString('utf8')))
  const bytes = gzipSync(Buffer.from(JSON.stringify(entries)), { level: 9 })
  const file = `oracle/${name}${kind === 'writes' ? '.writes' : ''}.json.gz`
  mkdirSync(join(out, 'oracle'), { recursive: true })
  writeFileSync(join(out, file), bytes)
  hashInto(out, file, bytes)
}

/**
 * Moves an overlay and its recordings onto a rebuilt baseline. A rebuild makes every UUID and install time afresh, so
 * an overlay aligned to the old build names entities the new one does not have. Each is matched as `alignTo` matches
 * them, by internal id or machine name.
 *
 * @param from - The baseline the overlay was made against, such as the preset's dump before the rebuild.
 * @param to - The rebuilt baseline.
 * @param name - The overlay's name.
 * @param out - The directory of overlays that holds it.
 * @returns The files rewritten, relative to `out`.
 */
export const realignOverlay = (from: string, to: string, name: string, out: string): string[] => {
  const align = alignTo(to, from)
  const files = [`${name}.json.gz`, `oracle/${name}.json.gz`, `oracle/${name}.writes.json.gz`].filter((file) => existsSync(join(out, file)))
  if (!files.includes(`${name}.json.gz`)) throw new Error(`No overlay named ${name} in ${out}.`)
  // Every file is read and aligned before any is written: one that cannot be read leaves the overlay as it was, not
  // half on each baseline.
  const written = files.map((file) => [file, gzipSync(Buffer.from(JSON.stringify(align(read<unknown>(out, file)))), { level: 9 })] as const)
  for (const [file, bytes] of written) {
    writeFileSync(join(out, file), bytes)
    hashInto(out, file, bytes)
  }
  return files
}

/**
 * Takes away an overlay's write recordings and their hash, for a variant built again without write scripts: scripts
 * left from an earlier build would be replayed against an overlay they were not recorded with.
 *
 * @param out - The directory of overlays.
 * @param name - The overlay's name.
 */
export const dropOverlayWrites = (out: string, name: string): void => {
  const file = `oracle/${name}.writes.json.gz`
  rmSync(join(out, file), { force: true })
  const manifestFile = join(out, 'manifest.json')
  if (!existsSync(manifestFile)) return
  const { [file]: _dropped, ...manifest } = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, string>
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
}
