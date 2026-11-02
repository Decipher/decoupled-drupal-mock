import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src/graphql.ts'
import { loadDump } from '../src/load.ts'
import { listen } from '../src/serve.ts'
import type { Resource } from '../src/types.ts'
import { oracleDir } from './oracle-dir.ts'

/** Every GraphQL query a preset's build recorded, answered by the engine and compared with Drupal's answer. */
interface Entry { name: string, query: string, variables?: Record<string, unknown>, status: number, answer: unknown }

const dir = process.env.DECOUPLED_DRUPAL_MOCK_DUMP || fileURLToPath(new URL('../../../presets/umami/dump', import.meta.url))
const available = existsSync(join(oracleDir(dir), 'graphql.json.gz'))

describe.skipIf(!available)('the engine against the recorded GraphQL queries', () => {
  const dump = available ? loadDump(dir) : undefined
  const entries = available ? JSON.parse(gunzipSync(readFileSync(join(oracleDir(dir), 'graphql.json.gz'))).toString('utf8')) as Entry[] : []
  const drupal = dump ? createDrupal(dump, { baseUrl: dump.manifest.origin }) : undefined

  it.each(entries.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const { status, body } = drupal!.handle('POST', `${dump!.manifest.origin}${dump!.graphql!.compose.endpoint}`, { 'content-type': 'application/json' }, JSON.stringify({ query: entry.query, ...(entry.variables ? { variables: entry.variables } : {}) }))
    expect(status).toBe(entry.status)
    expect(body).toEqual(entry.answer)
  })
})

describe.skipIf(!available)('the GraphQL endpoint as a transport', () => {
  const dump = available ? loadDump(dir) : undefined

  it('answers a GET with the query in the URL, and over HTTP', async () => {
    const drupal = createDrupal(dump!, { baseUrl: dump!.manifest.origin })
    const got = drupal.handle('GET', `${dump!.manifest.origin}/graphql?query=${encodeURIComponent('{ info { version } }')}`)
    expect(got.status).toBe(200)
    expect(got.body).toEqual({ data: { info: { version: '1' } } })
    let bound: Awaited<ReturnType<typeof listen>> | undefined
    for (let attempt = 0; attempt < 5 && !bound; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000)
      bound = await listen(createDrupal(dump!, { baseUrl: `http://127.0.0.1:${port}` }), port).catch(() => undefined)
    }
    const { url, close } = bound!
    try {
      const response = await fetch(`${url}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ mediaImages(first: 1) { nodes { mediaImage { url } } } }' }) })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json')
      const body = await response.json() as { data: { mediaImages: { nodes: Array<{ mediaImage: { url: string } }> } } }
      // A file URL names the server the engine was created for.
      expect(body.data.mediaImages.nodes[0]!.mediaImage.url).toMatch(new RegExp(`^${url}/sites/default/files/`))
    } finally {
      await close()
    }
  })

  it('takes the menu enum Drupal\'s schema declares for a hyphenated menu', () => {
    const drupal = createDrupal(dump!, { baseUrl: dump!.manifest.origin })
    const got = drupal.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query: '{ menu(name: NAVIGATION_USER_LINKS) { name } }' }))
    expect(got.body).toEqual({ data: { menu: { name: 'Navigation user links' } } })
  })

  it('answers a malformed request as Drupal does, and never throws', () => {
    const drupal = createDrupal(dump!, { baseUrl: dump!.manifest.origin })
    const post = (body: string) => drupal.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, body)
    expect(post('null')).toMatchObject({ status: 200, body: { errors: [{ extensions: { category: 'request' } }] } })
    expect(post('[1]').status).toBe(500)
    expect(post('{"query":"{ info { version } }","variables":"{"}').body).toEqual({ errors: [{ message: 'GraphQL Request parameter "variables" must be object or JSON string parsed to object, but got "{"', extensions: { category: 'request' } }] })
    expect(drupal.handle('GET', `${dump!.manifest.origin}/graphql?query=${encodeURIComponent('{ info { version } }')}&variables=%7B`).body).toEqual({ data: { info: { version: '1' } } })
  })

  it('refuses a visitor whose role lacks the permission, as Drupal does', () => {
    const permission = 'execute graphql_compose_server arbitrary graphql requests'
    const roles = (dump!.resources[dump!.manifest.defaultLanguage]!['user_role--user_role'] || []).map((role): Resource => {
      const attributes = role.attributes as { drupal_internal__id?: string, permissions?: string[] }
      return attributes.drupal_internal__id === 'anonymous' ? { ...role, attributes: { ...attributes, permissions: (attributes.permissions || []).filter((held) => held !== permission) } } : role
    })
    const withoutPermission = { ...dump!, resources: { ...dump!.resources, [dump!.manifest.defaultLanguage]: { ...dump!.resources[dump!.manifest.defaultLanguage]!, 'user_role--user_role': roles } } }
    const drupal = createDrupal(withoutPermission, { baseUrl: dump!.manifest.origin })
    const got = drupal.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query: '{ info { version } }' }))
    expect(got.status).toBe(403)
    expect(got.body).toEqual({ message: `The '${permission}' permission is required.` })
  })
})
