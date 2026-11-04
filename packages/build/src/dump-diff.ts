import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Document, Manifest, Recorded, Resource } from 'decoupled-drupal-mock'
import { comparable } from 'decoupled-drupal-mock/testing'
import type { RecordedWrite } from 'decoupled-drupal-mock/recorded-writes'
import { INSTALL_TIMES, STABLE_KEYS, alignTo, read } from './overlay.ts'

/** How many items a list names before it gives the rest as a count. */
const SHOWN = 8

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** A themed page of Drupal's, which differs in every build by the hashes of its aggregated CSS and JavaScript. */
const themed = (body: unknown): boolean => typeof body === 'string' && body.trimStart().startsWith('<')

/** A list cut to what a reader takes in, with the rest as a count. */
const some = (items: string[]): string => (items.length > SHOWN ? `${items.slice(0, SHOWN).join(', ')} and ${items.length - SHOWN} more` : items.join(', '))

const code = (items: string[]): string[] => items.map((item) => `\`${item}\``)

/** What names an entity in either build: its internal id or machine name, else its UUID. */
const keyOf = (resource: Resource): string => {
  const attributes = (resource.attributes || {}) as Record<string, unknown>
  const stable = STABLE_KEYS.find((key) => attributes[key] !== undefined && attributes[key] !== null)
  return stable ? String(attributes[stable]) : resource.id
}

/** What a reader knows an entity by: its id in the build, with its name or title. */
const labelOf = (resource: Resource): string => {
  const attributes = (resource.attributes || {}) as Record<string, unknown>
  const name = [attributes.name, attributes.title, attributes.label].find((value) => typeof value === 'string') as string | undefined
  const key = keyOf(resource)
  return name && name !== key ? `${key} (${name})` : key
}

/** The fields that differ between two versions of one entity, leaving out when an install made or touched it. */
const changedFields = (from: Resource, to: Resource): string[] => {
  const fields: string[] = []
  for (const part of ['attributes', 'relationships'] as const) {
    const a = (from[part] || {}) as Record<string, unknown>
    const b = (to[part] || {}) as Record<string, unknown>
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (part === 'attributes' && INSTALL_TIMES.includes(field)) continue
      if (!same(a[field], b[field])) fields.push(field)
    }
  }
  return fields
}

const languagesOf = (dir: string): string[] => {
  try {
    return readdirSync(join(dir, 'resources')).sort()
  } catch {
    return []
  }
}

const typesOf = (dir: string, langcode: string): string[] => {
  try {
    return readdirSync(join(dir, 'resources', langcode)).map((file) => file.replace(/\.json\.gz$/, ''))
  } catch {
    return []
  }
}

/**
 * What a rebuild changed, as a page a reviewer reads in a minute. The old build is read in the new one's terms first,
 * so the UUIDs and install times every build makes afresh are not changes.
 *
 * @param from - The dump before.
 * @param to - The dump after.
 * @param oracles - The recordings beside each dump, when there are some.
 * @param oracles.from - The old dump's recordings.
 * @param oracles.to - The new dump's recordings.
 * @returns The summary, as Markdown.
 */
export const summarise = (from: string, to: string, oracles: { from?: string | undefined, to?: string | undefined } = {}): string => {
  const align = alignTo(to, from)
  const old = <T>(dir: string, file: string): T | undefined => {
    const value = read<T>(dir, file)
    return value === undefined ? undefined : align(value) as T
  }
  const lines: string[] = []
  const section = (title: string, body: string[]): void => {
    lines.push(`## ${title}`, '', ...(body.length ? body : ['No change.']), '')
  }

  const before = read<Manifest>(from, 'manifest.json')
  const after = read<Manifest>(to, 'manifest.json')
  const drupal: string[] = []
  if (before?.drupal.core !== after?.drupal.core) drupal.push(`- Core ${before?.drupal.core} to ${after?.drupal.core}`)
  if (before?.drupal.profile !== after?.drupal.profile) drupal.push(`- Profile ${before?.drupal.profile} to ${after?.drupal.profile}`)
  const modulesBefore = before?.drupal.modules || {}
  const modulesAfter = after?.drupal.modules || {}
  const added = Object.keys(modulesAfter).filter((name) => !(name in modulesBefore)).sort()
  const removed = Object.keys(modulesBefore).filter((name) => !(name in modulesAfter)).sort()
  const updated = Object.keys(modulesAfter).filter((name) => name in modulesBefore && modulesBefore[name] !== modulesAfter[name]).sort()
  if (added.length) drupal.push(`- Added ${some(added.map((name) => `${name} ${modulesAfter[name]}`))}`)
  if (removed.length) drupal.push(`- Removed ${some(removed)}`)
  if (updated.length) drupal.push(`- Updated ${some(updated.map((name) => `${name} ${modulesBefore[name]} to ${modulesAfter[name]}`))}`)
  if (!same(before?.drupal.patches || {}, after?.drupal.patches || {})) drupal.push('- The patches changed')
  section('Drupal', drupal)

  const languages = [...new Set([...Object.keys(before?.languages || {}), ...Object.keys(after?.languages || {}), ...languagesOf(from), ...languagesOf(to)])].sort()
  const index: string[] = []
  for (const langcode of languages) {
    const a = Object.keys(read<Document>(from, `index/${langcode}.json`)?.links || {})
    const b = Object.keys(read<Document>(to, `index/${langcode}.json`)?.links || {})
    const gained = b.filter((type) => !a.includes(type)).sort()
    const lost = a.filter((type) => !b.includes(type)).sort()
    if (gained.length) index.push(`- ${langcode}: added ${some(code(gained))}`)
    if (lost.length) index.push(`- ${langcode}: removed ${some(code(lost))}`)
  }
  section('Index', index)

  // One row per type, its languages together: a rebuild usually changes both the same way.
  const rows = new Map<string, Map<string, string>>()
  const details: string[] = []
  for (const langcode of languages) {
    for (const type of [...new Set([...typesOf(from, langcode), ...typesOf(to, langcode)])].sort()) {
      const a = old<Resource[]>(from, `resources/${langcode}/${type}.json.gz`)
      const b = read<Resource[]>(to, `resources/${langcode}/${type}.json.gz`)
      let cell: string | undefined
      if (!a) cell = `new, ${b!.length}`
      else if (!b) cell = `gone, was ${a.length}`
      else {
        const byKey = new Map(a.map((resource) => [keyOf(resource), resource]))
        const keys = new Set(b.map(keyOf))
        const gained = b.filter((resource) => !byKey.has(keyOf(resource))).length
        const lost = a.filter((resource) => !keys.has(keyOf(resource))).length
        const fields = new Map<string, number>()
        let changed = 0
        for (const resource of b) {
          const was = byKey.get(keyOf(resource))
          if (!was) continue
          const differ = changedFields(was, resource)
          if (differ.length) changed++
          for (const field of differ) fields.set(field, (fields.get(field) || 0) + 1)
        }
        if ((gained || lost || changed) && langcode === (after?.defaultLanguage || languages[0])) {
          const which = [
            gained ? `added ${some(b.filter((resource) => !byKey.has(keyOf(resource))).map(labelOf))}` : '',
            lost ? `removed ${some(a.filter((resource) => !keys.has(keyOf(resource))).map(labelOf))}` : '',
            changed ? `changed ${some(b.filter((resource) => byKey.has(keyOf(resource)) && changedFields(byKey.get(keyOf(resource))!, resource).length).map((resource) => `${labelOf(resource)} from ${labelOf(byKey.get(keyOf(resource))!)}`))}` : '',
          ].filter(Boolean)
          details.push(`- \`${type}\`, ${langcode}: ${which.join('. ')}`)
        }
        if (gained || lost || changed) {
          const counts = [gained ? `${gained} added` : '', lost ? `${lost} removed` : '', changed ? `${changed} changed (${some([...fields].sort((x, y) => y[1] - x[1]).map(([field]) => `\`${field}\``))})` : ''].filter(Boolean)
          cell = `${a.length} to ${b.length}: ${counts.join(', ')}`
        }
      }
      if (cell) (rows.get(type) || rows.set(type, new Map()).get(type)!).set(langcode, cell)
    }
  }
  const resources: string[] = []
  if (rows.size) {
    resources.push(`| Type | ${languages.join(' | ')} |`, `| --- | ${languages.map(() => '---').join(' | ')} |`)
    for (const [type, cells] of rows) resources.push(`| \`${type}\` | ${languages.map((langcode) => cells.get(langcode) || '').join(' | ')} |`)
    if (details.length) resources.push('', 'Each entity is named by its internal id, so one that kept its name under another id reads as a change.', '', ...details)
  }
  section('Resources', resources)

  const routesBefore = old<Record<string, Recorded>>(from, 'recorded/routes.json.gz') || {}
  const routesAfter = read<Record<string, Recorded>>(to, 'recorded/routes.json.gz') || {}
  section('Recorded routes', answers(Object.entries(routesBefore).map(([key, value]) => [key, value]), Object.entries(routesAfter).map(([key, value]) => [key, value])))

  const access: string[] = []
  for (const langcode of languages) {
    const a = (old<Record<string, unknown>>(from, `access/${langcode}.json.gz`) || {})
    const b = (read<Record<string, unknown>>(to, `access/${langcode}.json.gz`) || {})
    const types = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((type) => !same(a[type], b[type])).sort()
    if (types.length) access.push(`- ${langcode}: what a visitor may read changed for ${some(code(types))}`)
  }
  section('Visitor access', access)

  if (oracles.from && oracles.to) {
    const reads = (dir: string, aligned: boolean): Array<[string, Recorded]> => ((aligned ? old : read)<Array<{ request: string, status: number, body: unknown }>>(dir, 'reads.json.gz') || []).map((entry) => [`GET ${entry.request}`, { status: entry.status, headers: {}, body: entry.body }])
    section('Oracle reads', answers(reads(oracles.from, true), reads(oracles.to, false)))
    const writesBefore = old<RecordedWrite[]>(oracles.from, 'writes.json.gz') || []
    const writesAfter = read<RecordedWrite[]>(oracles.to, 'writes.json.gz') || []
    const scripts: string[] = []
    for (const script of writesAfter) {
      const was = writesBefore.find((candidate) => candidate.name === script.name)
      const now = script.answers.map((answer) => answer.status).join(' ')
      if (!was) scripts.push(`- New script "${script.name}": ${now}`)
      else if (was.answers.map((answer) => answer.status).join(' ') !== now) scripts.push(`- "${script.name}": ${was.answers.map((answer) => answer.status).join(' ')} to ${now}`)
    }
    for (const script of writesBefore) if (!writesAfter.some((candidate) => candidate.name === script.name)) scripts.push(`- Script "${script.name}" is gone`)
    section('Oracle writes, by status', scripts)
  }
  return `${lines.join('\n').trim()}\n`
}

/** What changed between two sets of recorded answers: the status changes by name, and the rest as counts. */
const answers = (from: Array<[string, Recorded]>, to: Array<[string, Recorded]>): string[] => {
  const before = new Map(from)
  const after = new Map(to)
  const gained = [...after.keys()].filter((key) => !before.has(key)).sort()
  const lost = [...before.keys()].filter((key) => !after.has(key)).sort()
  const status: string[] = []
  const bodies: string[] = []
  for (const [key, answer] of after) {
    const was = before.get(key)
    if (!was) continue
    if (was.status !== answer.status) status.push(`${key}: ${was.status} to ${answer.status}`)
    // `comparable` sets aside what Drupal salts afresh on every answer: the keys of omitted items' links.
    else if (!(themed(was.body) && themed(answer.body)) && !same(comparable(was.body), comparable(answer.body))) bodies.push(key)
  }
  const out: string[] = []
  if (gained.length) out.push(`- ${gained.length} added: ${some(code(gained))}`)
  if (lost.length) out.push(`- ${lost.length} removed: ${some(code(lost))}`)
  for (const line of status.sort().slice(0, SHOWN)) out.push(`- \`${line.split(': ')[0]}\`: ${line.split(': ').slice(1).join(': ')}`)
  if (status.length > SHOWN) out.push(`- and ${status.length - SHOWN} more status changes`)
  if (bodies.length) out.push(`- ${bodies.length} of ${after.size} answer with the same status and a different body: ${some(code(bodies.sort()))}`)
  return out
}
