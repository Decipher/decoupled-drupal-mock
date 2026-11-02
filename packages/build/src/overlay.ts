import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
  index: Record<string, Document>
  access: Record<string, unknown>
}

const read = <T>(dir: string, file: string): T | undefined => {
  try {
    const bytes = readFileSync(join(dir, file))
    return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T
  } catch {
    return undefined
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// What differs between any two recordings and means nothing: when a user last signed in, and themed error pages.
const noise = (resource: Resource): Resource => {
  if (resource.type !== 'user--user') return resource
  const { access: _access, changed: _changed, ...attributes } = (resource.attributes || {}) as Record<string, unknown>
  return { ...resource, attributes }
}
const quiet = (recording: Recorded | undefined): unknown => {
  if (!recording) return undefined
  const body = typeof recording.body === 'string' && recording.body.startsWith('<') ? '<html>' : recording.body
  return { status: recording.status, body }
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
  const manifest = read<{ drupal: Overlay['drupal'], languages: Record<string, string> }>(variant, 'manifest.json')!
  const fromRecorded = read<Record<string, Recorded>>(base, 'recorded/routes.json.gz') || {}
  const toRecorded = read<Record<string, Recorded>>(variant, 'recorded/routes.json.gz') || {}
  const overlay: Overlay = { name, drupal: manifest.drupal, recorded: {}, removed: [], resources: {}, index: {}, access: {} }
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
      const to = read<Resource[]>(variant, `resources/${langcode}/${type}.json.gz`) || []
      if (!same(from.map(noise), to.map(noise))) (overlay.resources[langcode] ||= {})[type] = to
    }
    const fromIndex = read<Document>(base, `index/${langcode}.json`)
    const toIndex = read<Document>(variant, `index/${langcode}.json`)
    if (toIndex && !same(fromIndex, toIndex)) overlay.index[langcode] = toIndex
    const fromAccess = read<unknown>(base, `access/${langcode}.json.gz`)
    const toAccess = read<unknown>(variant, `access/${langcode}.json.gz`)
    if (!same(fromAccess, toAccess)) overlay.access[langcode] = toAccess ?? {}
  }
  return overlay
}

/**
 * Writes an overlay as a preset publishes it.
 *
 * @param overlay - The overlay.
 * @param out - The preset's `overlays` directory.
 */
export const writeOverlay = (overlay: Overlay, out: string): void => {
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${overlay.name}.json.gz`), gzipSync(Buffer.from(JSON.stringify(overlay)), { level: 9 }))
}

/* c8 ignore start */
if (process.argv[1]?.endsWith('overlay.ts')) {
  const [baseDir, variantDir, name, out] = process.argv.slice(2) as [string, string, string, string]
  const overlay = diffBuilds(baseDir, variantDir, name)
  writeOverlay(overlay, out)
  console.log(`${name}: ${Object.keys(overlay.recorded).length} recordings, ${overlay.removed.length} removed, ${Object.values(overlay.resources).flatMap(Object.keys).length} resource types, ${Object.keys(overlay.index).length} indexes`)
}
/* c8 ignore stop */
