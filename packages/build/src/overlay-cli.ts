#!/usr/bin/env -S node --experimental-strip-types
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { alignTo, diffBuilds, publishOverlayRecording, realignOverlay, writeOverlay } from './overlay.ts'

const USAGE = `Usage:
  decoupled-drupal-mock-overlay <baseline> <variant build> <name> <overlays directory>
    Writes the difference between the baseline, a build or a preset's dump, and a build of your site.
  decoupled-drupal-mock-overlay realign <old baseline> <new baseline> <name> <overlays directory>
    Moves an overlay made against the old baseline onto a rebuild of it.`

/* c8 ignore start */
const args = process.argv.slice(2)
if (args[0] === 'realign') {
  const [, from, to, name, out] = args
  if (!out) {
    console.error(USAGE)
    process.exit(1)
  }
  console.log(`${name}: realigned ${realignOverlay(from!, to!, name!, out).join(', ')}`)
} else {
  const [base, variant, name, out] = args
  if (!out) {
    console.error(USAGE)
    process.exit(1)
  }
  const overlay = diffBuilds(base!, variant!, name!)
  writeOverlay(overlay, out)
  // The variant's recordings, beside its build as the crawl writes them. Only a build given write scripts has writes.
  const recordings = `${variant!.replace(/\/+$/, '')}.oracle`
  const align = alignTo(base!, variant!)
  publishOverlayRecording(join(recordings, 'reads.json.gz'), out, name!, align)
  if (existsSync(join(recordings, 'writes.json.gz'))) publishOverlayRecording(join(recordings, 'writes.json.gz'), out, name!, align, 'writes')
  console.log(`${name}: ${Object.keys(overlay.recorded).length} recordings, ${overlay.removed.length} removed, ${Object.values(overlay.resources).flatMap(Object.keys).length} resource types, ${Object.keys(overlay.index).length} indexes`)
}
/* c8 ignore stop */
