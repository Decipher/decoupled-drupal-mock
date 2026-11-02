import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src/graphql.ts'
import { loadDump } from '../src/load.ts'
import { createMock } from '../src/mock.ts'
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

  it('answers behind the extensions, which can fail it like any other route', () => {
    const mock = createMock(dump!, { baseUrl: dump!.manifest.origin, create: createDrupal, extensions: [{ scenarios: { down: { answer: () => ({ status: 503, body: 'down' }) } } }] })
    const ask = () => mock.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query: '{ info { version } }' }))
    expect(ask().body).toEqual({ data: { info: { version: '1' } } })
    mock.scenario('down')
    expect(ask().status).toBe(503)
    mock.reset()
    expect(ask().status).toBe(200)
  })

  it('reads a build without drush, whose compose.json has no mapping', () => {
    const copy = mkdtempSync(join(tmpdir(), 'compose-'))
    cpSync(dir, copy, { recursive: true })
    const bare = JSON.stringify({ endpoint: '/graphql' })
    writeFileSync(join(copy, 'graphql', 'compose.json'), bare)
    const manifest = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8')) as { files: Record<string, string> }
    manifest.files['graphql/compose.json'] = createHash('sha256').update(bare).digest('hex')
    writeFileSync(join(copy, 'manifest.json'), JSON.stringify(manifest))
    const loaded = loadDump(copy)
    expect(loaded.graphql!.compose.types).toEqual({})
    expect(() => createDrupal(loaded, { baseUrl: loaded.manifest.origin })).not.toThrow()
  })

  it('takes GET, POST and HEAD, and answers anything else 405 as Drupal does', () => {
    const drupal = createDrupal(dump!, { baseUrl: dump!.manifest.origin })
    const put = drupal.handle('PUT', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query: '{ info { version } }' }))
    expect(put.status).toBe(405)
    expect(put.headers).toMatchObject({ 'content-type': 'text/html; charset=UTF-8', allow: 'GET, POST, HEAD' })
    expect(drupal.handle('HEAD', `${dump!.manifest.origin}/graphql?query=${encodeURIComponent('{ info { version } }')}`).status).toBe(200)
  })

  // Recorded from Drupal 11 with GraphQL Compose: a langcode on route sets the language for what follows it.
  it('moves the language for the root fields after a route or menu that names one, as Compose does', () => {
    const drupal = createDrupal(dump!, { baseUrl: dump!.manifest.origin })
    const ask = (query: string) => (drupal.handle('POST', `${dump!.manifest.origin}/en/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query })).body as { data: { info: { languages: Array<{ name: string }> } } }).data.info.languages.map((language) => language.name)
    expect(ask('{ info { languages { name } } route(path: "/es/recetas", langcode: "es") { __typename } }')).toEqual(['English', 'Spanish'])
    expect(ask('{ route(path: "/es/recetas", langcode: "es") { __typename } info { languages { name } } }')).toEqual(['Inglés', 'Español'])
  })

  it('answers a revision argument as Compose loads one, as far as the dump holds revisions', () => {
    const drupal = createDrupal(dump!, { baseUrl: dump!.manifest.origin })
    const [recipe, other] = dump!.resources[dump!.manifest.defaultLanguage]!['node--recipe']!
    const vid = (resource: Resource) => String((resource.attributes as { drupal_internal__vid: number }).drupal_internal__vid)
    const ask = (revision: string) => drupal.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query: `{ node(id: "${recipe!.id}", revision: "${revision}") { __typename } }` })).body as { data: { node: unknown }, errors?: Array<{ message: string }> }
    for (const revision of ['current', 'latest', vid(recipe!)]) expect(ask(revision).data.node).toEqual({ __typename: 'NodeRecipe' })
    expect(ask(vid(other!)).errors![0]!.message).toBe('The requested revision does not belong to the requested entity.')
    expect(ask('abc').data.node).toBeNull()
    expect(ask('99999999').data.node).toBeNull()
  })

  it('reads as the core engine does: a visitor what was visible, a signed-in user the rest, and no hidden field', () => {
    const lang = dump!.manifest.defaultLanguage
    const [hidden, shown] = dump!.resources[lang]!['node--recipe']!
    const ids = dump!.resources[lang]!['node--recipe']!.map((resource) => resource.id).filter((id) => id !== hidden!.id)
    const access = { ...dump!.access, [lang]: { ...dump!.access?.[lang], 'node--recipe': { visible: ids, hidden: ['revision_log', 'field_cooking_time'] } } }
    const drupal = createDrupal({ ...dump!, access }, { baseUrl: dump!.manifest.origin })
    const ask = (id: string, headers: Record<string, string> = {}) => (drupal.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json', ...headers }, JSON.stringify({ query: `{ node(id: "${id}") { ... on NodeRecipe { title cookingTime } } }` })).body as { data: { node: { title: string, cookingTime: number | null } | null } }).data.node
    expect(ask(hidden!.id)).toBeNull()
    expect(ask(shown!.id)).toMatchObject({ cookingTime: null })
    const admin = { authorization: `Bearer ${drupal.tokenFor('admin').access}` }
    expect(ask(hidden!.id, admin)?.title).toBe((hidden!.attributes as { title: string }).title)
    expect(ask(shown!.id, admin)?.cookingTime).not.toBeNull()
  })

  it('names, and lists in a connection, only the translations a visitor may read', () => {
    const es = Object.keys(dump!.manifest.languages).find((code) => code !== dump!.manifest.defaultLanguage)!
    const recipes = dump!.resources[es]!['node--recipe']!
    const [unpublished] = recipes
    const access = { ...dump!.access, [es]: { ...dump!.access?.[es], 'node--recipe': { ...dump!.access?.[es]?.['node--recipe'], visible: recipes.map((resource) => resource.id).filter((id) => id !== unpublished!.id) } } }
    const drupal = createDrupal({ ...dump!, access }, { baseUrl: dump!.manifest.origin })
    const post = (query: string) => drupal.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query })).body as { data: Record<string, unknown> }
    const node = post(`{ node(id: "${unpublished!.id}") { ... on NodeRecipe { translations { langcode { id } } } } }`).data.node as { translations: Array<{ langcode: { id: string } }> }
    expect(node.translations.map((translation) => translation.langcode.id)).not.toContain(es)
    const listed = post(`{ nodeRecipes(first: 100, langcode: "${es}") { nodes { id } } }`).data.nodeRecipes as { nodes: Array<{ id: string }> }
    expect(listed.nodes.map((item) => item.id)).not.toContain(unpublished!.id)
  })

  it('treats a URL as external by its origin, not by how it starts', () => {
    const drupal = createDrupal(dump!, { baseUrl: dump!.manifest.origin })
    const ask = (path: string) => (drupal.handle('POST', `${dump!.manifest.origin}/graphql`, { 'content-type': 'application/json' }, JSON.stringify({ query: `{ route(path: "${path}") { __typename } }` })).body as { data: { route: { __typename: string } | null } }).data.route
    expect(ask(`${dump!.manifest.origin}.evil/recipes`)).toEqual({ __typename: 'RouteExternal' })
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
