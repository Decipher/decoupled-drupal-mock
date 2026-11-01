import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { crawl } from './crawl.ts'

/**
 * `node --experimental-strip-types cli.ts <config.json>`: the crawl options as JSON, with `oracleFile` a path of one
 * request per line, and `drush` as `{ bin, cwd }` to read what JSON:API refuses every user.
 */
const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Parameters<typeof crawl>[0] & { oracleFile?: string, drush?: { bin: string, cwd: string }, excludeUsers?: string[] }
const oracle = config.oracleFile ? readFileSync(config.oracleFile, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')) : undefined

/** A config entity's array as JSON:API's attributes: `id` is `drupal_internal__id`, `uuid` and `_core` are not attributes. */
const attributesOf = (entity: Record<string, unknown>): Record<string, unknown> => {
  const { uuid: _uuid, _core, id, ...rest } = entity
  return { ...rest, ...(id !== undefined ? { drupal_internal__id: id } : {}) }
}

// Config entities only: a content entity's array holds its fields as lists of values, which is not JSON:API's shape.
const phantomData = config.drush
  ? async (entityType: string, uuid: string): Promise<Record<string, unknown> | undefined> => {
      const script = `$e = \\Drupal::service('entity.repository')->loadEntityByUuid('${entityType}', '${uuid}'); print json_encode($e instanceof \\Drupal\\Core\\Config\\Entity\\ConfigEntityInterface ? $e->toArray() : null);`
      const out = execFileSync(config.drush!.bin, ['php-eval', script], { cwd: config.drush!.cwd, encoding: 'utf8' }).trim().split('\n').pop() || 'null'
      const entity = JSON.parse(out) as Record<string, unknown> | null
      return entity ? attributesOf(entity) : undefined
    }
  : undefined

// The build's own user, which the site has only because the build crawls as it.
const excludeUsers = new Set(config.excludeUsers || [])
const exclude = excludeUsers.size
  ? (resource: Parameters<NonNullable<Parameters<typeof crawl>[0]['exclude']>>[0]): boolean => resource.type === 'user--user' && excludeUsers.has(String((resource.attributes as { name?: string } | undefined)?.name))
  : undefined

const manifest = await crawl({ ...config, ...(oracle ? { oracle } : {}), ...(phantomData ? { phantomData } : {}), ...(exclude ? { exclude } : {}) })
console.log(`built ${manifest.preset} from Drupal ${manifest.drupal.core}: ${Object.keys(manifest.files).length} files`)
