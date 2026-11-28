import { describe, expect, it } from 'vitest'
import { createDrupal, createMock } from '../src'
import type { Dump } from '../src'
import { dump } from './dump'

const BASE = 'https://drupal.test'
const PUBLIC = 'max-age=300, public'
const PRIVATE = 'must-revalidate, no-cache, private'
const EXPIRES = 'Sun, 19 Nov 1978 05:00:00 GMT'

const cacheOf = (headers: Record<string, string>) => ({ 'cache-control': headers['cache-control'], vary: headers.vary, expires: headers.expires })

describe('the cache headers Drupal sends', () => {
  const drupal = createDrupal(dump, { baseUrl: BASE })
  const get = (path: string, headers: Record<string, string> = {}) => drupal.handle('GET', `${BASE}${path}`, headers)

  it('lets a visitor\'s read be kept for the page cache\'s maximum age, varied by cookie', () => {
    expect(cacheOf(get('/jsonapi').headers)).toEqual({ 'cache-control': PUBLIC, vary: 'Cookie, X-Consumer-ID', expires: EXPIRES })
    expect(get('/es/jsonapi/node/page').headers['cache-control']).toBe(PUBLIC)
    expect(drupal.handle('HEAD', `${BASE}/jsonapi`).headers['cache-control']).toBe(PUBLIC)
  })

  it('keeps a visitor\'s JSON:API error too, as Drupal caches a 400 or a 404 for a visitor', () => {
    const missing = get('/jsonapi/node/page/missing')
    expect(missing.status).toBe(404)
    expect(cacheOf(missing.headers)).toEqual({ 'cache-control': PUBLIC, vary: 'Cookie, X-Consumer-ID', expires: EXPIRES })
  })

  it('varies a path no route answers by consumer alone, as Drupal\'s exception page does', () => {
    const nowhere = get('/jsonapi/missing/test')
    expect(nowhere.status).toBe(404)
    expect(cacheOf(nowhere.headers)).toEqual({ 'cache-control': PUBLIC, vary: 'X-Consumer-ID', expires: EXPIRES })
    const userinfo = get('/oauth/userinfo')
    expect(userinfo.status).toBe(403)
    expect(cacheOf(userinfo.headers)).toEqual({ 'cache-control': PUBLIC, vary: 'X-Consumer-ID', expires: EXPIRES })
  })

  it('answers a request with a token privately, as the page cache keeps none', () => {
    const token = drupal.tokenFor('umami')
    expect(cacheOf(get('/jsonapi', { authorization: `Bearer ${token.access}` }).headers)).toEqual({ 'cache-control': PRIVATE, vary: 'X-Consumer-ID', expires: EXPIRES })
    expect(get('/jsonapi', { authorization: 'Bearer nope' }).headers['cache-control']).toBe(PRIVATE)
  })

  it('answers a signed-in session privately, and a cookie that names no session as a visitor', () => {
    const login = drupal.handle('POST', `${BASE}/user/login?_format=json`, { 'content-type': 'application/json' }, JSON.stringify({ name: 'umami', pass: 'secret' }))
    expect(login.headers['cache-control']).toBe(PRIVATE)
    const cookie = login.headers['set-cookie']!.split(';')[0]!
    expect(get('/jsonapi', { cookie }).headers['cache-control']).toBe(PRIVATE)
    expect(get('/jsonapi', { cookie: 'SESSabc=1' }).headers['cache-control']).toBe(PUBLIC)
  })

  it('never keeps a write, the session token, an authorization answer or a server error', () => {
    expect(drupal.handle('POST', `${BASE}/jsonapi/node/page`, { 'content-type': 'application/vnd.api+json' }, '{}').headers['cache-control']).toBe(PRIVATE)
    expect(cacheOf(get('/session/token').headers)).toEqual({ 'cache-control': PRIVATE, vary: 'X-Consumer-ID', expires: EXPIRES })
    expect(get('/oauth/authorize?response_type=code&client_id=nope').headers['cache-control']).toBe(PRIVATE)
    const refused = get('/jsonapi/block/block?page[offset]=50')
    expect(refused.status).toBe(500)
    expect(cacheOf(refused.headers)).toEqual({ 'cache-control': PRIVATE, vary: 'X-Consumer-ID', expires: EXPIRES })
  })

  it('keeps the token grant\'s own no-store', () => {
    const granted = drupal.handle('POST', `${BASE}/oauth/token`, { 'content-type': 'application/x-www-form-urlencoded' }, 'grant_type=client_credentials&client_id=nope&client_secret=nope')
    expect(granted.headers['cache-control']).toBe('no-store, private')
    expect(granted.headers.vary).toBe('X-Consumer-ID')
  })

  it('keeps what a recorded route sent apart from the site, and answers it privately with a token', () => {
    const recorded: Dump = { ...dump, recorded: { ...dump.recorded, 'GET /jsonapi/decoupled/settings': { status: 200, headers: { 'content-type': 'application/vnd.api+json', vary: 'Cookie, X-Consumer-ID, Authorization' }, body: { data: [] } } } }
    const own = createDrupal(recorded, { baseUrl: BASE })
    expect(cacheOf(own.handle('GET', `${BASE}/jsonapi/decoupled/settings`).headers)).toEqual({ 'cache-control': PUBLIC, vary: 'Cookie, X-Consumer-ID, Authorization', expires: EXPIRES })
    const signedIn = own.handle('GET', `${BASE}/jsonapi/decoupled/settings`, { authorization: `Bearer ${own.tokenFor('umami').access}` })
    expect(signedIn.headers['cache-control']).toBe(PRIVATE)
  })

  it('sends no Vary where the site sends none, as a site without Consumers does', () => {
    const plain = createDrupal({ ...dump, manifest: { ...dump.manifest, cache: { public: { 'cache-control': PUBLIC, vary: 'Cookie', expires: EXPIRES }, private: { 'cache-control': PRIVATE, expires: EXPIRES } } } }, { baseUrl: BASE })
    expect(cacheOf(plain.handle('GET', `${BASE}/jsonapi`).headers)).toEqual({ 'cache-control': PUBLIC, vary: 'Cookie', expires: EXPIRES })
    expect(cacheOf(plain.handle('GET', `${BASE}/jsonapi/missing/test`).headers)).toEqual({ 'cache-control': PUBLIC, vary: undefined, expires: EXPIRES })
    expect(Object.keys(plain.handle('GET', `${BASE}/session/token`).headers)).not.toContain('vary')
  })

  it('replays a recorded route that sent no Vary with none, as the build recorded it', () => {
    const locked: Dump = { ...dump, recorded: { ...dump.recorded, 'GET /jsonapi/decoupled/settings': { status: 403, headers: { 'content-type': 'application/vnd.api+json', 'cache-control': 'no-store, private', vary: '', expires: '' }, body: {} } } }
    const own = createDrupal(locked, { baseUrl: BASE })
    expect(cacheOf(own.handle('GET', `${BASE}/jsonapi/decoupled/settings`).headers)).toEqual({ 'cache-control': 'no-store, private', vary: undefined, expires: undefined })
  })

  it('answers a signed-in logout privately, as the session it ends was open when it was asked', () => {
    const login = drupal.handle('POST', `${BASE}/user/login?_format=json`, { 'content-type': 'application/json' }, JSON.stringify({ name: 'umami', pass: 'secret' }))
    const cookie = login.headers['set-cookie']!.split(';')[0]!
    expect(get('/user/logout', { cookie }).headers['cache-control']).toBe(PRIVATE)
  })

  it('sends none from a dump built before the build recorded them', () => {
    const { cache: _cache, ...manifest } = dump.manifest
    const older = createDrupal({ ...dump, manifest }, { baseUrl: BASE })
    expect(cacheOf(older.handle('GET', `${BASE}/jsonapi`).headers)).toEqual({ 'cache-control': undefined, vary: undefined, expires: undefined })
  })
})

describe('the cache headers on an extension\'s answer', () => {
  const mock = createMock(dump, {
    baseUrl: BASE,
    extensions: [{
      name: 'cache',
      routes: {
        'GET /own': () => ({ body: { own: true } }),
        'GET /kept': () => ({ headers: { 'Cache-Control': 'max-age=60, public' }, body: {} }),
        'GET /never': () => ({ headers: { 'cache-control': 'no-store' }, body: {} }),
        'GET /shared': () => ({ headers: { 'cache-control': 's-maxage=600' }, body: {} }),
      },
    }],
  })

  it('gives an extension\'s own answer the site\'s, and keeps a cache-control it sets', () => {
    expect(cacheOf(mock.handle('GET', `${BASE}/own`).headers)).toEqual({ 'cache-control': PUBLIC, vary: 'Cookie, X-Consumer-ID', expires: EXPIRES })
    const kept = mock.handle('GET', `${BASE}/kept`).headers
    expect(kept['cache-control']).toBe('max-age=60, public')
    expect(Object.keys(kept).filter((name) => name.toLowerCase() === 'cache-control')).toHaveLength(1)
    expect(mock.handle('GET', `${BASE}/never`).headers['cache-control']).toBe('no-store')
  })

  it('answers privately with a token, whatever the extension said for a visitor', () => {
    const authorization = `Bearer ${mock.tokenFor('umami').access}`
    expect(mock.handle('GET', `${BASE}/kept`, { authorization }).headers['cache-control']).toBe(PRIVATE)
    expect(mock.handle('GET', `${BASE}/never`, { authorization }).headers['cache-control']).toBe('no-store')
    // A shared cache may keep an answer to a request with a token when it says s-maxage, so that is not kept either.
    expect(mock.handle('GET', `${BASE}/shared`, { authorization }).headers['cache-control']).toBe(PRIVATE)
    expect(mock.handle('GET', `${BASE}/shared`).headers['cache-control']).toBe('s-maxage=600')
  })

  it('answers a signed-in logout privately through the mock too', () => {
    const login = mock.handle('POST', `${BASE}/user/login?_format=json`, { 'content-type': 'application/json' }, JSON.stringify({ name: 'umami', pass: 'secret' }))
    const cookie = login.headers['set-cookie']!.split(';')[0]!
    expect(mock.handle('GET', `${BASE}/user/logout`, { cookie }).headers['cache-control']).toBe(PRIVATE)
  })
})
