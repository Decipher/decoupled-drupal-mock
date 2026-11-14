import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src'
import type { Dump, Resource } from '../src'
import { dump, ORIGIN } from './dump'

/**
 * Canvas Headless's draft preview over a dump that recorded one: the claims of a real assertion, the content API's
 * answers to a preview token, and its answer to a token Drupal does not know. The claims are a Canvas 1.12.0 site's.
 */
const json = (body: unknown) => ({ status: 200, headers: { 'content-type': 'application/json' }, body })
const recorded: Dump['recorded'] = {
  ...dump.recorded,
  'POST /canvas-headless/assertion#claims': json({
    header: { typ: 'canvas-headless-preview-assertion+jwt', alg: 'RS256' },
    claims: { iat: 1, nbf: 1, exp: 61, iss: '47bbc322-f7be-41da-9be8-82d15cf6ac1f', aud: '/oauth/token', sub: '2', jti: 'x', azp: 'canvas_headless', use: 'activation', path: '/', resourceVersion: 'rel:working-copy', renewUrl: `${ORIGIN}/canvas-headless/renew` },
    draftUrl: 'http://127.0.0.1:3000/api/draft',
  }),
  'GET /canvas/content-api?requestUri=%2Fcanvas': json({ content: 'published' }),
  'GET /canvas/content-api?requestUri=%2Fcanvas#preview': json({ content: 'draft' }),
  'GET /canvas/content-api?requestUri=%2Fdecoupled-drupal-mock%2Fnot-found': { status: 404, headers: { 'content-type': 'application/problem+json' }, body: { type: 'about:blank', title: 'Not Found', status: 404 } },
  'GET /canvas/content-api#unauthorized': { status: 401, headers: { 'content-type': 'application/problem+json' }, body: { type: 'about:blank', title: 'Unauthorized', status: 401 } },
}
// The fixture's editor role may preview, as Drupal CMS's content editor does once the preset's recipe grants it.
const roles = (dump.resources.en!['user_role--user_role'] as Resource[]).map((role) => role.id === 'role-editor' ? { ...role, attributes: { ...role.attributes, permissions: [...(role.attributes!.permissions as string[]), 'access canvas headless preview'] } } : role)
const canvasDump: Dump = { ...dump, recorded, resources: { ...dump.resources, en: { ...dump.resources.en, 'user_role--user_role': roles } } }

const setUp = () => {
  let clock = Date.parse('2026-11-14T00:00:00Z')
  const drupal = createDrupal(canvasDump, { baseUrl: 'https://drupal.test', now: () => clock })
  const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: string) => {
    const response = await drupal.fetch(`https://drupal.test${path}`, { method, headers, ...(body === undefined ? {} : { body }), redirect: 'manual' })
    const text = await response.text()
    return { status: response.status, headers: response.headers, text, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) as Record<string, unknown> : undefined }
  }
  const signIn = async () => {
    const login = await call('POST', '/user/login?_format=json', { 'content-type': 'application/json' }, JSON.stringify({ name: 'umami', pass: 'secret' }))
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const csrf = (await call('GET', '/session/token', { cookie })).text
    return { cookie, csrf }
  }
  const mint = async (query: string, credentials: { cookie: string, csrf: string }) => call('POST', `/canvas-headless/assertion?${query}`, { cookie: credentials.cookie, 'x-csrf-token': credentials.csrf })
  const redeem = (assertion: string, extra: Record<string, string> = {}) => call('POST', '/oauth/token', { 'content-type': 'application/x-www-form-urlencoded' }, new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion, client_id: 'canvas_headless', ...extra }).toString())
  return { drupal, call, signIn, mint, redeem, tick: (ms: number) => { clock += ms } }
}
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
const verifier = 'v'.repeat(43)
const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')

describe('Canvas Headless\'s draft preview', () => {
  it('mints an assertion for an editor\'s cookie session, redeems it once for a preview token, and reads drafts with it', async () => {
    const { call, signIn, mint, redeem } = setUp()
    const minted = await mint('path=/canvas', await signIn())
    expect(minted.status).toBe(200)
    const assertion = minted.body!.assertion as string
    const [header, claims, signature] = assertion.split('.')
    expect(decode(header!)).toEqual({ typ: 'canvas-headless-preview-assertion+jwt', alg: 'RS256' })
    expect(decode(claims!)).toMatchObject({ iss: '47bbc322-f7be-41da-9be8-82d15cf6ac1f', aud: '/oauth/token', sub: '2', azp: 'canvas_headless', use: 'activation', path: '/canvas', resourceVersion: 'rel:working-copy', renewUrl: 'https://drupal.test/canvas-headless/renew' })
    const { iat, exp } = decode(claims!) as { iat: number, exp: number }
    expect(exp - iat).toBe(60)
    // The length of an RS256 signature over a 2048-bit key.
    expect(signature).toHaveLength(342)

    const token = await redeem(assertion)
    expect(token.status).toBe(200)
    expect(token.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 })
    expect((await call('GET', '/canvas/content-api?requestUri=/canvas', { authorization: `Bearer ${token.body!.access_token as string}` })).body).toEqual({ content: 'draft' })
    expect((await call('GET', '/canvas/content-api?requestUri=/canvas')).body).toEqual({ content: 'published' })
    expect((await call('GET', '/canvas/content-api?requestUri=/nope', { authorization: `Bearer ${token.body!.access_token as string}` })).status).toBe(404)

    expect((await redeem(assertion)).body).toMatchObject({ error: 'invalid_grant', hint: 'The assertion has already been used.' })
  })

  it('takes the entity Canvas edits in place of a path, and names its alias', async () => {
    const { signIn, mint } = setUp()
    const credentials = await signIn()
    const assertion = (await mint('entity_type=node&entity=1', credentials)).body!.assertion as string
    expect(decode(assertion.split('.')[1]!).path).toBe('/page/about-umami')
    expect((await mint('entity_type=node&entity=99', credentials)).status).toBe(404)
    expect((await mint('entity_type=nope&entity=1', credentials)).status).toBe(400)
    expect((await mint('path=canvas', credentials)).status).toBe(400)
  })

  it('refuses a visitor, a bearer token in place of the cookie, a missing or wrong CSRF token, and a GET', async () => {
    const { drupal, call, signIn } = setUp()
    const { cookie, csrf } = await signIn()
    const token = drupal.tokenFor('umami').access
    expect((await call('POST', '/canvas-headless/assertion?path=/', { 'x-csrf-token': csrf })).status).toBe(403)
    expect((await call('POST', '/canvas-headless/assertion?path=/', { authorization: `Bearer ${token}`, 'x-csrf-token': csrf })).status).toBe(403)
    expect((await call('POST', '/canvas-headless/assertion?path=/', { cookie })).status).toBe(403)
    expect((await call('POST', '/canvas-headless/assertion?path=/', { cookie, 'x-csrf-token': 'nope' })).status).toBe(403)
    const get = await call('GET', '/canvas-headless/assertion?path=/', { cookie, 'x-csrf-token': csrf })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
  })

  it('redeems a renewal only with the verifier of the challenge the session registered', async () => {
    const { signIn, mint, redeem } = setUp()
    const credentials = await signIn()
    expect((await redeem((await mint('path=/canvas', credentials)).body!.assertion as string, { code_challenge: challenge, code_challenge_method: 'S256' })).status).toBe(200)
    const renewal = async () => (await mint('path=/canvas&renewal=1', credentials)).body!.assertion as string
    expect((await redeem(await renewal())).body).toMatchObject({ hint: 'A renewal assertion requires the session code_verifier.' })
    expect((await redeem(await renewal(), { code_verifier: 'w'.repeat(43) })).body).toMatchObject({ hint: 'The code_verifier does not prove a running preview session.' })
    const renewed = await redeem(await renewal(), { code_verifier: verifier })
    expect(renewed.status).toBe(200)
    // The challenge proves one renewal; the next needs the challenge that renewal registered.
    expect((await redeem(await renewal(), { code_verifier: verifier })).body).toMatchObject({ hint: 'The code_verifier does not prove a running preview session.' })
  })

  it('refuses an assertion it did not mint, a malformed one, an expired one and a challenge it cannot read', async () => {
    const { signIn, mint, redeem, tick } = setUp()
    const credentials = await signIn()
    const assertion = (await mint('path=/', credentials)).body!.assertion as string
    const [header, claims] = assertion.split('.')
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...decode(claims!), jti: 'forged' })).toString('base64url')}.sig`
    expect((await redeem(forged)).body).toMatchObject({ hint: 'Token signature mismatch' })
    expect((await redeem('not-a-jwt')).body).toMatchObject({ hint: 'The assertion is malformed.' })
    expect((await redeem(`${Buffer.from('{"typ":"JWT"}').toString('base64url')}.${claims}.sig`)).body).toMatchObject({ hint: 'The assertion is not a preview assertion.' })
    expect((await redeem((await mint('path=/', credentials)).body!.assertion as string, { code_challenge: challenge, code_challenge_method: 'plain' })).body).toMatchObject({ error: 'invalid_request' })
    const late = (await mint('path=/', credentials)).body!.assertion as string
    tick(91_000)
    expect((await redeem(late)).body).toMatchObject({ hint: 'The token is expired' })
    expect((await redeem(late, { client_id: 'nope' })).status).toBe(401)
  })

  it('redirects a standalone renewal to the frontend\'s draft route with a fresh assertion', async () => {
    const { call, signIn } = setUp()
    const { cookie } = await signIn()
    const renewed = await call('GET', '/canvas-headless/renew?path=/canvas', { cookie })
    expect(renewed.status).toBe(302)
    const location = new URL(renewed.headers.get('location')!)
    expect(`${location.origin}${location.pathname}`).toBe('http://127.0.0.1:3000/api/draft')
    expect(decode(location.searchParams.get('assertion')!.split('.')[1]!)).toMatchObject({ path: '/canvas', use: 'activation' })
    expect((await call('GET', '/canvas-headless/renew?path=/canvas')).status).toBe(403)
  })

  it('answers a token Drupal does not know as Canvas does, and has no preview on a dump that recorded none', async () => {
    const { call } = setUp()
    const refused = await call('GET', '/canvas/content-api?requestUri=/canvas', { authorization: 'Bearer a.b.c' })
    expect(refused).toMatchObject({ status: 401, body: { title: 'Unauthorized' } })
    const plain = createDrupal(dump, { baseUrl: 'https://drupal.test' })
    expect((await plain.fetch('https://drupal.test/canvas-headless/assertion?path=/', { method: 'POST' })).headers.get('content-type')).toContain('text/html')
    expect((await (await plain.fetch('https://drupal.test/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&client_id=canvas_headless&assertion=x' })).json() as { error: string }).error).toBe('invalid_client')
  })
})
