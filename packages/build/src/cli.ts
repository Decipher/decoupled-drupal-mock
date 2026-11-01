#!/usr/bin/env -S node --experimental-strip-types
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { crawl } from './crawl.ts'

/**
 * `node --experimental-strip-types cli.ts <config.json>`: the crawl options as JSON, with `oracleFile` a path of one
 * request per line, and `drush` as `{ bin, cwd }` to read what JSON:API refuses every user.
 */
const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Parameters<typeof crawl>[0] & { oracleFile?: string, drush?: { bin: string, cwd: string }, excludeUsers?: string[] }

const drush = (script: string): string => {
  try {
    return execFileSync(config.drush!.bin, ['php-eval', script], { cwd: config.drush!.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop() || ''
  } catch (err) {
    const failure = err as { stderr?: string, stdout?: string }
    throw new Error(`drush php-eval failed:\n${(failure.stderr || '').slice(-1500)}\n${(failure.stdout || '').slice(-500)}\nscript: ${script.slice(0, 400)}`)
  }
}
/** A value as a PHP expression: JSON decoded into arrays, so a string, a list and a map all read as PHP writes them. */
const php = (value: unknown): string => `json_decode('${JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', TRUE)`

// The accounts and consumers the preset signs in, created in the Drupal before the crawl so the oracle is real.
if (config.identities && config.drush) {
  for (const account of config.identities.accounts) {
    drush(`$types = \\Drupal::entityTypeManager(); $users = $types->getStorage('user')->loadByProperties(['name' => ${php(account.name)}]); $user = reset($users) ?: $types->getStorage('user')->create(['name' => ${php(account.name)}, 'mail' => ${php(`${account.name}@example.com`)}, 'status' => 1]); ${account.password !== undefined ? `$user->setPassword(${php(account.password)});` : ''} foreach (${php(account.roles || [])} as $role) $user->addRole($role); $user->save(); print 'ok';`)
  }
  for (const consumer of config.identities.consumers) {
    const scopes = Object.entries(consumer.scopes || {})
    drush(`use Drupal\\simple_oauth\\Entity\\Oauth2Scope; use Drupal\\simple_oauth\\Oauth2ScopeInterface;
      foreach (${php(scopes)} as [$id, $role]) { if (!Oauth2Scope::load($id)) Oauth2Scope::create(['id' => $id, 'name' => $id, 'description' => $id, 'grant_types' => ['client_credentials' => ['status' => TRUE, 'description' => $id], 'password' => ['status' => TRUE, 'description' => $id], 'authorization_code' => ['status' => TRUE, 'description' => $id], 'refresh_token' => ['status' => TRUE, 'description' => $id]], 'umbrella' => FALSE, 'granularity_id' => Oauth2ScopeInterface::GRANULARITY_ROLE, 'granularity_configuration' => ['role' => $role]])->save(); }
      $types = \\Drupal::entityTypeManager(); $consumers = $types->getStorage('consumer')->loadByProperties(['client_id' => ${php(consumer.clientId)}]); $c = reset($consumers) ?: $types->getStorage('consumer')->create(['client_id' => ${php(consumer.clientId)}, 'label' => ${php(consumer.clientId)}]);
      ${consumer.secret !== undefined ? `$c->set('secret', ${php(consumer.secret)});` : ''} $c->set('confidential', ${consumer.confidential ? 'TRUE' : 'FALSE'}); $c->set('pkce', ${consumer.pkce ? 'TRUE' : 'FALSE'}); $c->set('grant_types', ${php(consumer.grants)}); $c->set('scopes', array_map(fn($id) => ['scope_id' => $id], array_keys(${php(consumer.scopes || {})})));
      ${consumer.user ? `$users = $types->getStorage('user')->loadByProperties(['name' => ${php(consumer.user)}]); if ($u = reset($users)) $c->set('user_id', $u->id());` : ''} $c->save(); print 'ok';`)
  }
}
const oracle = config.oracleFile ? readFileSync(config.oracleFile, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')) : undefined

/** A config entity's array as JSON:API's attributes: `id` is `drupal_internal__id`, `uuid` and `_core` are not attributes. */
const attributesOf = (entity: Record<string, unknown>): Record<string, unknown> => {
  const { uuid: _uuid, _core, id, ...rest } = entity
  return { ...rest, ...(id !== undefined ? { drupal_internal__id: id } : {}) }
}

// Config entities only: a content entity's array holds its fields as lists of values, which is not JSON:API's shape.
const phantomData = config.drush
  ? async (entityType: string, uuid: string): Promise<Record<string, unknown> | undefined> => {
      // Both reach PHP inside a string, and the UUID comes from a response: anything else is not an entity to ask for.
      if (!/^[a-z0-9_]+$/.test(entityType) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return undefined
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
