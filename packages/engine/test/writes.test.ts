import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createDrupal } from '../src'
import type { Document, Resource } from '../src'
import { dump } from './dump'

const BASE = 'https://drupal.test'
const JSON_API = { 'content-type': 'application/vnd.api+json' }
const drupal = () => createDrupal(dump, { baseUrl: BASE })
const read = async (response: Response): Promise<Document> => {
  const text = await response.text()
  return text.startsWith('<') || !text ? { meta: { html: text } } : JSON.parse(text) as Document
}
const token = async (d: ReturnType<typeof drupal>, form: Record<string, string>) => {
  const response = await d.fetch(`${BASE}/oauth/token`, { method: 'POST', body: new URLSearchParams(form) })
  return { status: response.status, body: await response.json() as Record<string, unknown>, headers: response.headers }
}
const bearer = (access: string) => ({ authorization: `Bearer ${access}` })

describe('Simple OAuth', () => {
  it('grants client credentials as the consumer\'s user, with the scope\'s role, and refuses what league refuses', async () => {
    const d = drupal()
    const ok = await token(d, { grant_type: 'client_credentials', client_id: 'druxt', client_secret: 's3cret', scope: 'editor' })
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ token_type: 'Bearer', expires_in: 300, access_token: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/) })
    expect(ok.headers.get('cache-control')).toBe('no-store, private')
    expect((await token(d, { grant_type: 'client_credentials', client_id: 'druxt', client_secret: 'nope' }))).toMatchObject({ status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } })
    expect((await token(d, { grant_type: 'client_credentials', client_id: 'nope' })).status).toBe(401)
    expect((await token(d, { grant_type: 'implicit', client_id: 'druxt', client_secret: 's3cret' })).body).toMatchObject({ error: 'unsupported_grant_type', hint: 'Check that all required parameters have been provided' })
    expect((await token(d, { grant_type: 'client_credentials', client_id: 'druxt', client_secret: 's3cret', scope: 'nope' })).body).toMatchObject({ error: 'invalid_scope', hint: 'Check the `nope` scope' })
  })

  it('grants a password, refreshes with rotation, and names the user in userinfo', async () => {
    const d = drupal()
    expect((await token(d, { grant_type: 'password', client_id: 'druxt', client_secret: 's3cret', username: 'umami', password: 'wrong' })).body).toMatchObject({ error: 'invalid_grant', error_description: 'The user credentials were incorrect.' })
    const first = await token(d, { grant_type: 'password', client_id: 'druxt', client_secret: 's3cret', username: 'umami', password: 'secret' })
    expect(first.body.refresh_token).toBeDefined()
    const info = await (await d.fetch(`${BASE}/oauth/userinfo`, { headers: bearer(String(first.body.access_token)) })).json() as Record<string, unknown>
    expect(info).toMatchObject({ sub: '2', name: 'umami', preferred_username: 'umami', email: 'umami@example.com', email_verified: true, profile: `${BASE}/user/2`, locale: 'en', zoneinfo: 'UTC' })
    const second = await token(d, { grant_type: 'refresh_token', client_id: 'druxt', client_secret: 's3cret', refresh_token: String(first.body.refresh_token) })
    expect(second.status).toBe(200)
    expect((await token(d, { grant_type: 'refresh_token', client_id: 'druxt', client_secret: 's3cret', refresh_token: String(first.body.refresh_token) })).body).toMatchObject({ error: 'invalid_grant' })
    // The old access token is gone with its refresh token.
    expect((await d.fetch(`${BASE}/jsonapi/node/page`, { headers: bearer(String(first.body.access_token)) })).status).toBe(401)
    expect((await d.fetch(`${BASE}/oauth/userinfo`)).status).toBe(403)
  })

  it('refuses a token it did not issue as Drupal does, with the WWW-Authenticate header', async () => {
    const response = await drupal().fetch(`${BASE}/jsonapi/node/page`, { headers: bearer('garbage') })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer realm="OAuth", error="access_denied", error_description="The JWT string must have two dots"')
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('runs the authorization code flow with PKCE for a cookie session, and refuses without one', async () => {
    const d = drupal()
    const verifier = 'a-verifier-of-at-least-forty-three-characters-long-enough'
    const challenge = createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const authorize = `${BASE}/oauth/authorize?response_type=code&client_id=public&redirect_uri=${encodeURIComponent('https://site.test/callback')}&state=xyz&code_challenge=${challenge}&code_challenge_method=S256`
    expect((await d.fetch(authorize, { redirect: 'manual' })).status).toBe(403)
    const login = await d.fetch(`${BASE}/user/login?_format=json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'umami', pass: 'secret' }) })
    expect(login.status).toBe(200)
    expect(await login.json()).toMatchObject({ current_user: { uid: '2', name: 'umami' }, csrf_token: expect.any(String) })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const redirect = await d.fetch(authorize, { headers: { cookie }, redirect: 'manual' })
    expect(redirect.status).toBe(302)
    const location = new URL(redirect.headers.get('location')!)
    expect(location.origin + location.pathname).toBe('https://site.test/callback')
    expect(location.searchParams.get('state')).toBe('xyz')
    const code = location.searchParams.get('code')!
    expect((await token(d, { grant_type: 'authorization_code', client_id: 'public', code, code_verifier: 'wrong', redirect_uri: 'https://site.test/callback' })).body).toMatchObject({ error: 'invalid_grant' })
    const granted = await token(d, { grant_type: 'authorization_code', client_id: 'public', code, code_verifier: verifier, redirect_uri: 'https://site.test/callback' })
    expect(granted.status).toBe(200)
    expect(granted.body.refresh_token).toBeDefined()
    // The session token and a logout.
    expect((await (await d.fetch(`${BASE}/session/token`, { headers: { cookie } })).text()).length).toBeGreaterThan(20)
    expect((await d.fetch(`${BASE}/user/logout?_format=json`, { method: 'POST', headers: { cookie } })).status).toBe(204)
    expect((await d.fetch(authorize, { headers: { cookie }, redirect: 'manual' })).status).toBe(403)
  })
})

describe('writes', () => {
  const page = { data: { type: 'node--page', attributes: { title: 'A new page' } } }

  it('refuses a visitor, creates for an editor as Drupal does, and the page is then served', async () => {
    const d = drupal()
    const anonymous = await d.fetch(`${BASE}/jsonapi/node/page`, { method: 'POST', headers: JSON_API, body: JSON.stringify(page) })
    expect(anonymous.status).toBe(403)
    const editor = d.tokenFor('umami')
    const created = await d.fetch(`${BASE}/jsonapi/node/page`, { method: 'POST', headers: { ...JSON_API, ...bearer(editor.access) }, body: JSON.stringify(page) })
    expect(created.status).toBe(201)
    const document = await read(created)
    const resource = document.data as Resource
    expect(created.headers.get('location')).toBe(`${BASE}/jsonapi/node/page/${resource.id}?resourceVersion=id%3A6`)
    expect(resource.attributes).toMatchObject({ drupal_internal__nid: 6, drupal_internal__vid: 6, langcode: 'en', status: true, title: 'A new page', promote: false, sticky: false, default_langcode: true, path: { alias: null, pid: null, langcode: 'en' }, body: null })
    expect(resource.attributes!.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/)
    expect(resource.relationships!.uid!.data).toEqual({ type: 'user--user', id: 'u-1', meta: { drupal_internal__target_id: 2 } })
    expect(resource.relationships!.node_type!.data).toEqual({ type: 'node_type--node_type', id: 'nt-page', meta: { drupal_internal__target_id: 'page' } })
    expect(document.links!.self!.href).toBe(`${BASE}/jsonapi/node/page`)
    expect(((await read(await d.fetch(`${BASE}/jsonapi/node/page/${resource.id}`))).data as Resource).attributes!.title).toBe('A new page')
    expect(((await read(await d.fetch(`${BASE}/jsonapi/node/page?filter[title]=A new page`))).data as Resource[]).length).toBe(1)
    // Another instance, and this one after a reset, know nothing of it.
    expect((await drupal().fetch(`${BASE}/jsonapi/node/page/${resource.id}`)).status).toBe(404)
    d.reset()
    expect((await d.fetch(`${BASE}/jsonapi/node/page/${resource.id}`)).status).toBe(404)
  })

  it('answers 422 for a required field left empty, as a draft for a moderated bundle, and 405 for a config type', async () => {
    const d = drupal()
    const admin = d.tokenFor('admin')
    const missing = await d.fetch(`${BASE}/jsonapi/node/page`, { method: 'POST', headers: { ...JSON_API, ...bearer(admin.access) }, body: JSON.stringify({ data: { type: 'node--page', attributes: {} } }) })
    expect(missing.status).toBe(422)
    expect((await read(missing)).errors).toEqual([{ title: 'Unprocessable Content', status: '422', detail: 'title: This value should not be null.', source: { pointer: '/data/attributes/title' } }])
    const time = await d.fetch(`${BASE}/jsonapi/node/recipe`, { method: 'POST', headers: { ...JSON_API, ...bearer(admin.access) }, body: JSON.stringify({ data: { type: 'node--recipe', attributes: { title: 'Soup' } } }) })
    expect((await read(time)).errors![0]!.detail).toBe('field_cooking_time: This value should not be null.')
    const recipe = await read(await d.fetch(`${BASE}/jsonapi/node/recipe`, { method: 'POST', headers: { ...JSON_API, ...bearer(admin.access) }, body: JSON.stringify({ data: { type: 'node--recipe', attributes: { title: 'Soup', field_cooking_time: 20 } } }) }))
    const resource = recipe.data as Resource
    expect(resource.attributes).toMatchObject({ status: false, moderation_state: 'draft', field_cooking_time: 20 })
    expect(resource.relationships!.field_tags).toEqual({ data: [] })
    expect(resource.links!['working-copy']!.href).toContain('resourceVersion=rel%3Aworking-copy')
    expect((await d.fetch(`${BASE}/jsonapi/block/block`, { method: 'POST', headers: { ...JSON_API, ...bearer(admin.access) }, body: '{}' })).status).toBe(405)
  })

  it('updates with Drupal\'s id, read-only and transition answers, and deletes', async () => {
    const d = drupal()
    const editor = bearer(d.tokenFor('umami').access)
    const patch = (id: string, body: unknown, headers: Record<string, string> = editor) => d.fetch(`${BASE}/jsonapi/node/recipe/${id}`, { method: 'PATCH', headers: { ...JSON_API, ...headers }, body: JSON.stringify(body) })
    const mismatch = await patch('r-1', { data: { type: 'node--recipe', id: 'r-2', attributes: { title: 'x' } } })
    expect(mismatch.status).toBe(400)
    expect((await read(mismatch)).errors![0]!.detail).toBe('The selected entity (r-1) does not match the ID in the payload (r-2).')
    const readOnly = await patch('r-1', { data: { type: 'node--recipe', id: 'r-1', attributes: { drupal_internal__nid: 9 } } })
    expect(readOnly.status).toBe(403)
    expect((await read(readOnly)).errors![0]).toMatchObject({ detail: 'The current user is not allowed to PATCH the selected field (nid). The entity ID cannot be changed.', source: { pointer: '/data/attributes/nid' } })
    const unknown = await patch('r-1', { data: { type: 'node--recipe', id: 'r-1', attributes: { nope: 1 } } })
    expect((await read(unknown)).errors![0]!.detail).toBe('The attribute nope does not exist on the node--recipe resource type.')
    // A visitor has no transition on the moderated recipe.
    const visitor = await patch('r-1', { data: { type: 'node--recipe', id: 'r-1', attributes: { title: 'x' } } }, {})
    expect((await read(visitor)).errors![0]!.detail).toBe('No valid transitions exist for given account.')
    const updated = await patch('r-1', { data: { type: 'node--recipe', id: 'r-1', attributes: { field_cooking_time: 31 } } })
    expect(updated.status).toBe(200)
    const resource = (await read(updated)).data as Resource
    expect(resource.attributes!.field_cooking_time).toBe(31)
    expect(resource.attributes!.title).toBe('Deep mediterranean quiche')
    expect(((await read(await d.fetch(`${BASE}/jsonapi/node/recipe/r-1`))).data as Resource).attributes!.field_cooking_time).toBe(31)
    // Delete: the editor may not delete another's recipe, the administrator may, then it is gone.
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1`, { method: 'DELETE', headers: editor })).status).toBe(403)
    const admin = bearer(d.tokenFor('admin').access)
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1`, { method: 'DELETE', headers: admin })).status).toBe(204)
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1`, { method: 'DELETE', headers: admin })).status).toBe(404)
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1`)).status).toBe(404)
  })

  it('reads and rewrites a relationship', async () => {
    const d = drupal()
    const admin = bearer(d.tokenFor('admin').access)
    const relationship = await read(await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`))
    expect(relationship.data).toEqual([{ type: 'taxonomy_term--tags', id: 't-1' }, { type: 'taxonomy_term--tags', id: 't-2' }])
    expect(relationship.links!.self!.href).toBe(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`)
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`, { method: 'DELETE', headers: { ...JSON_API, ...admin }, body: JSON.stringify({ data: [{ type: 'taxonomy_term--tags', id: 't-1' }] }) })).status).toBe(204)
    expect((await read(await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`))).data).toEqual([{ type: 'taxonomy_term--tags', id: 't-2' }])
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`, { method: 'POST', headers: { ...JSON_API, ...admin }, body: JSON.stringify({ data: [{ type: 'taxonomy_term--tags', id: 't-1' }] }) })).status).toBe(204)
    expect((await read(await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`))).data).toHaveLength(2)
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`, { method: 'PATCH', headers: JSON_API, body: '{"data":[]}' })).status).toBe(403)
  })
})

describe('the relationship routes and inherited members', () => {
  it('answers no inherited member as a relationship, to a read or a write', async () => {
    const d = createDrupal(dump, { baseUrl: BASE })
    const admin = bearer(d.tokenFor('admin').access)
    for (const name of ['__proto__', 'constructor', 'toString']) {
      expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/${name}`)).status, name).toBe(404)
      expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/${name}`, { method: 'PATCH', headers: { ...JSON_API, ...admin }, body: '{"data":[]}' })).status, name).toBe(404)
    }
  })
})

describe('what the review of the writes found', () => {
  /** The Umami-shaped dump with the editor's role cut to drafting recipes, and a path alias type to create. */
  const drafting = () => {
    const copy = structuredClone(dump)
    const en = copy.resources.en!
    for (const role of en['user_role--user_role']!) {
      if ((role.attributes as { drupal_internal__id?: string }).drupal_internal__id === 'editor') (role.attributes as { permissions: string[] }).permissions = ['edit any recipe content', 'create recipe content', 'use editorial transition create_new_draft']
    }
    en['path_alias--path_alias'] = []
    return createDrupal(copy, { baseUrl: BASE })
  }
  const send = (d: ReturnType<typeof drupal>, method: string, path: string, headers: Record<string, string>, body?: unknown) => d.fetch(`${BASE}${path}`, { method, headers: { ...JSON_API, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const details = async (response: Response) => ((await read(response)).errors || []).map((problem) => problem.detail)

  it('requires a path and an alias of a path alias, each its own error', async () => {
    const d = drafting()
    const response = await send(d, 'POST', '/jsonapi/path_alias/path_alias', bearer(d.tokenFor('admin').access), { data: { type: 'path_alias--path_alias', attributes: {} } })
    expect(response.status).toBe(422)
    expect(await details(response)).toEqual(['path: This value should not be null.', 'alias: This value should not be null.'])
  })

  it('answers a malformed login as Drupal does, and does not throw', async () => {
    const d = drupal()
    const login = (body: string) => d.fetch(`${BASE}/user/login?_format=json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    expect((await login('{nope')).status).toBe(500)
    for (const body of ['null', '{}']) {
      const response = await login(body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ message: 'Missing credentials.' })
    }
  })

  it('checks the transition a moderated write asks for, and sets the published flag from it', async () => {
    const d = drafting()
    const editor = bearer(d.tokenFor('umami').access)
    const draft = ((await read(await send(d, 'POST', '/jsonapi/node/recipe', editor, { data: { type: 'node--recipe', attributes: { title: 'Soup', field_cooking_time: 1 } } }))).data as Resource).id
    const published = await send(d, 'PATCH', `/jsonapi/node/recipe/${draft}`, editor, { data: { type: 'node--recipe', id: draft, attributes: { moderation_state: 'published' } } })
    expect(published.status).toBe(422)
    expect(await details(published)).toEqual(['moderation_state: You do not have access to transition from Draft to Published'])
    const created = await send(d, 'POST', '/jsonapi/node/recipe', editor, { data: { type: 'node--recipe', attributes: { title: 'Soup', field_cooking_time: 1, moderation_state: 'published' } } })
    expect(await details(created)).toEqual(['moderation_state: You do not have access to transition from Draft to Published'])
    const nowhere = await send(d, 'PATCH', `/jsonapi/node/recipe/${draft}`, editor, { data: { type: 'node--recipe', id: draft, attributes: { moderation_state: 'nowhere' } } })
    expect((await details(nowhere))[0]).toContain('nowhere does not exist')
    const admin = bearer(d.tokenFor('admin').access)
    const live = await read(await send(d, 'POST', '/jsonapi/node/recipe', admin, { data: { type: 'node--recipe', attributes: { title: 'Soup', field_cooking_time: 1, moderation_state: 'published' } } }))
    expect((live.data as Resource).attributes).toMatchObject({ moderation_state: 'published', status: true })
  })

  it('refuses a POST the generated fields, as Drupal does', async () => {
    const d = drafting()
    const admin = bearer(d.tokenFor('admin').access)
    const post = (attributes: Record<string, unknown>) => send(d, 'POST', '/jsonapi/node/recipe', admin, { data: { type: 'node--recipe', attributes: { title: 'Soup', field_cooking_time: 1, ...attributes } } })
    const id = await post({ drupal_internal__nid: 9999 })
    expect(id.status).toBe(403)
    expect(await details(id)).toEqual(['The current user is not allowed to POST the selected field (drupal_internal__nid). The entity ID cannot be changed.'])
    expect(await details(await post({ status: true }))).toEqual(['The current user is not allowed to POST the selected field (status). Cannot edit the published field of moderated entities.'])
  })

  it('keeps a user\'s roles and a node\'s owner to those who may set them', async () => {
    const d = drafting()
    const editor = bearer(d.tokenFor('umami').access)
    const self = await send(d, 'PATCH', '/jsonapi/user/user/u-1', editor, { data: { type: 'user--user', id: 'u-1', relationships: { roles: { data: [{ type: 'user_role--user_role', id: 'r-admin' }] } } } })
    expect(self.status).toBe(403)
    expect(await details(self)).toEqual(['The current user is not allowed to PATCH the selected field (roles).'])
    const route = await send(d, 'PATCH', '/jsonapi/user/user/u-1/relationships/roles', editor, { data: [] })
    expect(await details(route)).toEqual(['The current user is not allowed to edit this relationship.'])
    const owner = await send(d, 'PATCH', '/jsonapi/node/recipe/r-1/relationships/uid', editor, { data: { type: 'user--user', id: 'u-1' } })
    expect(await details(owner)).toEqual(["The current user is not allowed to edit this relationship. The 'administer nodes' permission is required."])
  })

  it('answers a to-one relationship\'s POST and DELETE with a 400, and refuses segments past a relationship', async () => {
    const d = drupal()
    const admin = bearer(d.tokenFor('admin').access)
    for (const method of ['POST', 'DELETE']) {
      const response = await send(d, method, '/jsonapi/node/recipe/r-1/relationships/uid', admin, { data: [{ type: 'user--user', id: 'u-1' }] })
      expect(response.status).toBe(400)
      expect(await details(response)).toEqual(['Invalid body payload for the relationship.'])
    }
    expect((await send(d, 'PATCH', '/jsonapi/node/recipe/r-1/relationships/field_tags/extra', admin, { data: [] })).status).toBe(404)
    expect(((await read(await d.fetch(`${BASE}/jsonapi/node/recipe/r-1/relationships/field_tags`))).data as unknown[]).length).toBeGreaterThan(0)
  })

  it('refuses a cookie session\'s write without its CSRF token', async () => {
    const d = drupal()
    const login = await d.fetch(`${BASE}/user/login?_format=json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'admin', pass: 'admin' }) })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const { csrf_token: csrf } = await login.json() as { csrf_token: string }
    const patch = (headers: Record<string, string>) => send(d, 'PATCH', '/jsonapi/node/page/p-1', { cookie, ...headers }, { data: { type: 'node--page', id: 'p-1', attributes: { title: 'New' } } })
    expect(await details(await patch({}))).toEqual(['X-CSRF-Token request header is missing'])
    expect(await details(await patch({ 'x-csrf-token': 'nope' }))).toEqual(['X-CSRF-Token request header is invalid'])
    expect((await patch({ 'x-csrf-token': csrf })).status).toBe(200)
  })

  it('answers a delete under a translation\'s prefix with Drupal\'s 405', async () => {
    const d = drupal()
    const admin = bearer(d.tokenFor('admin').access)
    const response = await send(d, 'DELETE', '/es/jsonapi/node/page/p-1', admin)
    expect(response.status).toBe(405)
    expect((await details(response))[0]).toContain('Deleting a resource object translation is not yet supported')
    expect((await d.fetch(`${BASE}/jsonapi/node/page/p-1`)).status).toBe(200)
  })

  it('gives no one else\'s account in full to a signed-in user without the permission', async () => {
    const copy = structuredClone(dump)
    copy.access = { en: { 'user--user': { hidden: ['mail', 'status', 'roles'] } } }
    const en = copy.resources.en!
    en['user--user'] = en['user--user']!.map((account) => ({ ...account, attributes: { ...account.attributes, mail: 'm@example.com', status: true, login: 1 } }))
    for (const role of en['user_role--user_role']!) (role.attributes as { permissions?: string[] }).permissions = []
    const d = createDrupal(copy, { baseUrl: BASE })
    const umami = bearer(d.tokenFor('umami').access)
    const own = (await read(await d.fetch(`${BASE}/jsonapi/user/user/u-1`, { headers: umami }))).data as Resource
    expect(own.attributes!.mail).toBe('m@example.com')
    expect(own.attributes!.status).toBeUndefined()
    expect(own.attributes!.login).toBeUndefined()
    const admin = en['user--user']!.find((account) => account.id !== 'u-1')!
    const other = (await read(await d.fetch(`${BASE}/jsonapi/user/user/${admin.id}`, { headers: umami }))).data as Resource
    expect(other.attributes!.mail).toBeUndefined()
    expect((await d.fetch(`${BASE}/jsonapi/user/user?filter[mail]=m`, { headers: umami })).status).toBe(403)
    expect((await d.fetch(`${BASE}/jsonapi/user/user/${admin.id}/relationships/roles`, { headers: umami })).status).toBe(403)
    expect((await d.fetch(`${BASE}/jsonapi/user/user/${admin.id}/relationships/roles`)).status).toBe(403)
  })

  it('forgets every token on reset, and never gives a deleted resource\'s id again', async () => {
    const d = drupal()
    const { access } = d.tokenFor('admin')
    const admin = bearer(access)
    const post = async () => ((await read(await send(d, 'POST', '/jsonapi/node/page', admin, { data: { type: 'node--page', attributes: { title: 'New' } } }))).data as Resource)
    const first = await post()
    await send(d, 'DELETE', `/jsonapi/node/page/${first.id}`, admin)
    const second = await post()
    expect((second.attributes as { drupal_internal__nid: number }).drupal_internal__nid).toBeGreaterThan((first.attributes as { drupal_internal__nid: number }).drupal_internal__nid)
    d.reset()
    expect((await d.fetch(`${BASE}/jsonapi/node/page`, { headers: admin })).status).toBe(401)
  })

  it('reads a scope through the consumer holding the token, and refuses a consumer bound to no user', async () => {
    const copy = structuredClone(dump)
    copy.identities!.consumers = [
      { clientId: 'a', secret: 's', confidential: true, grants: ['client_credentials'], scopes: { shared: 'administrator' }, user: 'umami' },
      { clientId: 'b', secret: 's', confidential: true, grants: ['client_credentials'], scopes: { shared: 'editor' }, user: 'umami' },
      { clientId: 'c', secret: 's', confidential: true, grants: ['client_credentials'], scopes: { shared: 'editor' } },
    ]
    const d = createDrupal(copy, { baseUrl: BASE })
    const granted = await token(d, { grant_type: 'client_credentials', client_id: 'b', client_secret: 's', scope: 'shared' })
    const response = await d.fetch(`${BASE}/jsonapi/block/block`, { method: 'GET', headers: bearer(String(granted.body.access_token)) })
    expect(response.status).toBe(200)
    const denied = await send(d, 'DELETE', '/jsonapi/taxonomy_term/tags/t-1', bearer(String(granted.body.access_token)))
    expect(denied.status).toBe(403)
    expect((await token(d, { grant_type: 'client_credentials', client_id: 'c', client_secret: 's', scope: 'shared' })).status).toBe(401)
  })

  it('issues a code only to a registered redirect URI and for the consumer\'s scopes, and lets it expire', async () => {
    const copy = structuredClone(dump)
    copy.identities!.consumers[1]!.scopes = { editor: 'editor' }
    const d = createDrupal(copy, { baseUrl: BASE })
    const login = await d.fetch(`${BASE}/user/login?_format=json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'umami', pass: 'secret' }) })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const verifier = 'v'.repeat(43)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const authorize = (redirect: string, scope = '') => d.fetch(`${BASE}/oauth/authorize?response_type=code&client_id=public&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256${scope ? `&scope=${scope}` : ''}`, { headers: { cookie }, redirect: 'manual' })
    expect((await authorize('https://evil.test/callback')).status).toBe(400)
    expect((await authorize('https://site.test/callback', 'administrator')).status).toBe(400)
    const issued = await authorize('https://site.test/callback', 'editor')
    expect(issued.status).toBe(302)
    const code = new URL(issued.headers.get('location')!).searchParams.get('code')!
    vi.useFakeTimers({ now: Date.now() + 301_000 })
    try {
      expect((await token(d, { grant_type: 'authorization_code', client_id: 'public', code, code_verifier: verifier, redirect_uri: 'https://site.test/callback' })).status).toBe(400)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('what a signed-in user reaches', () => {
  it('reads what the anonymous user may not, and a token nobody issued reads nothing', async () => {
    const d = createDrupal({ ...dump, access: { en: { 'node--recipe': { hidden: ['field_difficulty'], visible: ['r-1'] } } } }, { baseUrl: BASE })
    const anonymous = await read(await d.fetch(`${BASE}/jsonapi/node/recipe`))
    expect((anonymous.data as Resource[]).map((resource) => resource.id)).toEqual(['r-1'])
    expect((anonymous.data as Resource[])[0]!.attributes).not.toHaveProperty('field_difficulty')
    const name = (dump.identities?.accounts || [])[0]?.name || 'umami'
    const headers = { authorization: `Bearer ${d.tokenFor(name).access}` }
    const signedIn = await read(await d.fetch(`${BASE}/jsonapi/node/recipe`, { headers }))
    expect((signedIn.data as Resource[]).map((resource) => resource.id)).toEqual(['r-1', 'r-2', 'r-3'])
    expect((signedIn.data as Resource[])[0]!.attributes).toHaveProperty('field_difficulty')
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe`, { headers: { authorization: 'Bearer nobody-issued-this' } })).status).toBe(401)
  })
})

describe('writes across languages, and accounts without a user', () => {
  const es = { ...dump.resources.en!, 'node--recipe': dump.resources.en!['node--recipe']!.filter((recipe) => recipe.id === 'r-1').map((recipe) => ({ ...recipe, attributes: { ...recipe.attributes, title: 'Quiche' } })) }
  const multilingual = () => createDrupal({ ...dump, manifest: { ...dump.manifest, languages: { en: '', es: 'es' } }, resources: { ...dump.resources, es } }, { baseUrl: BASE })
  const admin = (d: ReturnType<typeof drupal>) => ({ ...JSON_API, ...bearer(d.tokenFor('admin').access) })

  it('stores what is created under a prefix in the default language, and names the prefix in its links', async () => {
    const d = multilingual()
    const created = await d.fetch(`${BASE}/es/jsonapi/node/recipe`, { method: 'POST', headers: admin(d), body: JSON.stringify({ data: { type: 'node--recipe', attributes: { title: 'Created', field_cooking_time: 5 } } }) })
    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toContain('/es/jsonapi/node/recipe/')
    const { id } = (await read(created)).data as Resource
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/${id}`)).status).toBe(200)
    expect((await d.fetch(`${BASE}/es/jsonapi/node/recipe/${id}`)).status).toBe(200)
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/${id}`, { method: 'DELETE', headers: admin(d) })).status).toBe(204)
  })

  it('deletes an entity with all its translations', async () => {
    const d = multilingual()
    expect((await d.fetch(`${BASE}/es/jsonapi/node/recipe/r-1`)).status).toBe(200)
    expect((await d.fetch(`${BASE}/jsonapi/node/recipe/r-1`, { method: 'DELETE', headers: admin(d) })).status).toBe(204)
    expect((await d.fetch(`${BASE}/es/jsonapi/node/recipe/r-1`)).status).toBe(404)
    expect(((await read(await d.fetch(`${BASE}/es/jsonapi/node/recipe`))).data as Resource[]).map((recipe) => recipe.id)).not.toContain('r-1')
  })

  it('refuses a field name only an object inherits', async () => {
    const d = drupal()
    const patch = (data: string) => d.fetch(`${BASE}/jsonapi/node/recipe/r-1`, { method: 'PATCH', headers: admin(d), body: `{"data":{"type":"node--recipe","id":"r-1",${data}}}` })
    expect((await patch('"attributes":{"constructor":1}')).status).toBe(422)
    expect((await patch('"relationships":{"toString":{"data":null}}')).status).toBe(422)
  })

  it('takes the next revision id from the default language, under a prefix too', async () => {
    const d = multilingual()
    const vids = (dump.resources.en!['node--recipe'] || []).map((recipe) => Number((recipe.attributes as { drupal_internal__vid?: number }).drupal_internal__vid))
    const patched = await d.fetch(`${BASE}/es/jsonapi/node/recipe/r-1`, { method: 'PATCH', headers: admin(d), body: JSON.stringify({ data: { type: 'node--recipe', id: 'r-1', attributes: { title: 'Patched' } } }) })
    expect(patched.status).toBe(200)
    expect(((await read(patched)).data as Resource).attributes!.drupal_internal__vid).toBeGreaterThan(Math.max(...vids))
  })

  it('refuses a grant for an account whose user is gone, rather than throwing', async () => {
    const d = createDrupal({ ...dump, resources: { ...dump.resources, en: { ...dump.resources.en, 'user--user': dump.resources.en!['user--user']!.filter((user) => (user.attributes as { name?: string }).name !== 'umami') } } }, { baseUrl: BASE })
    expect(await token(d, { grant_type: 'password', client_id: 'druxt', client_secret: 's3cret', username: 'umami', password: 'secret' })).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
  })
})

