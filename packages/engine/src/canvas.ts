import { base64url, fromBase64url, randomBytes, randomUUID, sha256 } from './bytes.js'
import type { Identity, Session } from './identity.js'
import type { Dump, Resource } from './types.js'

/** What the build recorded of a real preview assertion: its header, its claims and where renewal sends the editor. */
interface AssertionTemplate { header: Record<string, unknown>, claims: Record<string, unknown>, draftUrl: string }

/** An assertion the mock minted, by its `jti`, until it is redeemed or expires. */
interface Minted { name: string, use: 'activation' | 'renewal', expires: number, used: boolean }

export interface CanvasAnswer { status: number, headers: Record<string, string>, body: unknown }

/** Canvas Headless's lifetimes, from its source: an assertion lives 60 seconds, a preview token 900. */
const ASSERTION_SECONDS = 60
const TOKEN_SECONDS = 900
/** The clock skew Canvas's grant allows an assertion. */
const LEEWAY_SECONDS = 30
const PREVIEW_PERMISSION = 'access canvas headless preview'
const NO_CACHE = 'must-revalidate, no-cache, private'

/**
 * Canvas Headless's draft preview, as its routes and its OAuth grant answer it. The Canvas editor mints a signed
 * assertion for an editor's cookie session; the frontend's server redeems it at `/oauth/token` with the jwt-bearer grant
 * for a preview token; the content API answers that token with drafts. The assertion's claims follow the one the build
 * recorded. Its signature is random bytes of the length an RS256 one has, so a client that reads the claims without
 * checking the signature, as Canvas's SDK does, reads it as it would a real one.
 */
export class CanvasPreview {
  private readonly minted = new Map<string, Minted>()
  /** PKCE challenges a redemption registered, by user and challenge: a renewal proves its session with the verifier. */
  private readonly challenges = new Map<string, number>()

  constructor(private readonly dump: Dump, private readonly identity: Identity, private readonly now: () => number = () => Date.now()) {}

  /** Whether the build recorded a preview, so the mock can give one. */
  get available(): boolean {
    return !!this.template()
  }

  reset(): void {
    this.minted.clear()
    this.challenges.clear()
  }

  private template(): AssertionTemplate | undefined {
    return this.dump.recorded['POST /canvas-headless/assertion#claims']?.body as AssertionTemplate | undefined
  }

  /** `POST /canvas-headless/assertion` and `GET /canvas-headless/renew`, which take only a cookie session. */
  route(method: string, path: string, query: Record<string, unknown>, headers: Record<string, string>, baseUrl: string, relink: (body: unknown) => unknown, resources: (type: string) => Resource[]): CanvasAnswer | undefined {
    if (path !== '/canvas-headless/assertion' && path !== '/canvas-headless/renew') return undefined
    const html = (status: number, title: string, extra: Record<string, string> = {}): CanvasAnswer => ({ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_CACHE, ...extra }, body: `<!DOCTYPE html><html><body><h1>${title}</h1></body></html>` })
    const assertion = path === '/canvas-headless/assertion'
    if (method !== (assertion ? 'POST' : 'GET') && method !== (assertion ? 'POST' : 'HEAD')) return html(405, 'Method Not Allowed', { allow: assertion ? 'POST' : 'GET' })
    const session = this.identity.cookieSession(headers)
    if (!session.user || !this.identity.permissions(session).has(PREVIEW_PERMISSION)) return html(403, 'Access denied')
    // The assertion route checks the CSRF header token. A request with none, or another session's, is refused.
    if (assertion) {
      const given = Object.entries(headers).find(([name]) => name.toLowerCase() === 'x-csrf-token')?.[1]
      if (!given || given !== this.identity.csrf(headers)) return html(403, 'Access denied')
    }
    const target = assertion ? this.entityPath(query, resources) : undefined
    if (target && 'status' in target) return html(target.status, target.title)
    const requested = target?.path ?? validPath(query.path)
    if (requested === undefined) return html(400, 'Bad Request')
    const renewal = assertion && ['1', 'true', 'on', 'yes'].includes(String(query.renewal ?? '').toLowerCase())
    const jwt = this.mint(session, requested, renewal, relink)
    if (assertion) return { status: 200, headers: { 'content-type': 'application/json', 'cache-control': NO_CACHE }, body: { assertion: jwt } }
    const location = `${relink(this.template()!.draftUrl) as string}?assertion=${encodeURIComponent(jwt)}`
    return { status: 302, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_CACHE, location }, body: `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url='${location}'" /><title>Redirecting to ${location}</title></head><body>Redirecting to <a href="${location}">${location}</a>.</body></html>` }
  }

  /** The canonical path of `entity_type` and `entity`, as the assertion route reads them, or why there is none. */
  private entityPath(query: Record<string, unknown>, resources: (type: string) => Resource[]): { path: string } | { status: number, title: string } | undefined {
    const type = String(query.entity_type ?? '')
    const id = String(query.entity ?? '')
    if (!type && !id) return undefined
    const bundles: Record<string, [string, string]> = { canvas_page: ['canvas_page--', 'drupal_internal__id'], node: ['node--', 'drupal_internal__nid'] }
    const known = bundles[type]
    if (!known) return { status: 400, title: 'Bad Request' }
    const entity = resources(known[0]).find((resource) => String((resource.attributes as Record<string, unknown> | undefined)?.[known[1]]) === id)
    if (!entity) return { status: 404, title: 'Page not found' }
    const alias = (entity.attributes as { path?: { alias?: string | null } } | undefined)?.path?.alias
    return { path: alias || `/${type === 'node' ? 'node' : 'page'}/${id}` }
  }

  /** A preview assertion for the session's user, with the recorded one's issuer, audience and renewal URL. */
  private mint(session: Session, path: string, renewal: boolean, relink: (body: unknown) => unknown): string {
    const template = this.template()!
    const seconds = Math.floor(this.now() / 1000)
    const jti = randomUUID()
    const name = String((session.user!.attributes as { name?: string }).name)
    const claims: Record<string, unknown> = { ...template.claims, iat: seconds, nbf: seconds, exp: seconds + ASSERTION_SECONDS, sub: String(session.uid), jti, use: renewal ? 'renewal' : 'activation', path, renewUrl: relink(template.claims.renewUrl) }
    this.minted.set(jti, { name, use: renewal ? 'renewal' : 'activation', expires: (seconds + ASSERTION_SECONDS) * 1000, used: false })
    // RS256 over a 2048-bit key is 256 bytes of signature.
    return `${base64url(JSON.stringify(template.header))}.${base64url(JSON.stringify(claims))}.${base64url(randomBytes(256))}`
  }

  /** `POST /oauth/token` with the jwt-bearer grant, as Canvas Headless's grant answers it. Any other grant is not this one's. */
  grant(form: URLSearchParams): { status: number, body: Record<string, unknown> } | undefined {
    if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || !this.available) return undefined
    const invalidGrant = (hint: string) => ({ status: 400, body: { error: 'invalid_grant', error_description: 'The provided authorization grant (e.g., authorization code, resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.', hint } })
    const invalidRequest = (parameter: string, hint = `Check the \`${parameter}\` parameter`) => ({ status: 400, body: { error: 'invalid_request', error_description: 'The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed.', hint } })
    if (form.get('client_id') !== 'canvas_headless') return { status: 401, body: { error: 'invalid_client', error_description: 'Client authentication failed' } }
    const jwt = form.get('assertion')
    if (!jwt) return invalidRequest('assertion')
    const parts = jwt.split('.')
    let header: { typ?: unknown } | undefined
    let claims: { jti?: unknown, azp?: unknown } | undefined
    try {
      header = JSON.parse(fromBase64url(parts[0] || '')) as { typ?: unknown }
      claims = JSON.parse(fromBase64url(parts[1] || '')) as { jti?: unknown, azp?: unknown }
    } catch {
      return invalidGrant('The assertion is malformed.')
    }
    if (parts.length !== 3 || !header || !claims) return invalidGrant('The assertion is malformed.')
    if (header.typ !== this.template()!.header.typ) return invalidGrant('The assertion is not a preview assertion.')
    // An assertion the mock did not mint is one whose signature Drupal's key would not verify.
    const minted = this.minted.get(String(claims.jti))
    if (!minted) return invalidGrant('Token signature mismatch')
    if (this.now() > minted.expires + LEEWAY_SECONDS * 1000) return invalidGrant('The token is expired')
    if (claims.azp !== 'canvas_headless') return invalidGrant('The assertion was issued to a different client.')
    let proof: string | undefined
    if (minted.use === 'renewal') {
      const verifier = form.get('code_verifier') || ''
      if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return invalidGrant('A renewal assertion requires the session code_verifier.')
      proof = `${minted.name}:${base64url(sha256(verifier))}`
      if ((this.challenges.get(proof) ?? 0) < this.now()) return invalidGrant('The code_verifier does not prove a running preview session.')
    }
    if (minted.used) return invalidGrant('The assertion has already been used.')
    minted.used = true
    const challenge = form.get('code_challenge')
    if (challenge !== null) {
      if (form.get('code_challenge_method') !== 'S256') return invalidRequest('code_challenge_method', 'Only the S256 code challenge method is supported.')
      if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return invalidRequest('code_challenge', 'The code challenge must be the base64url-encoded SHA-256 hash of the verifier.')
    }
    const token = this.identity.issuePreview(minted.name, TOKEN_SECONDS)
    if (proof) this.challenges.delete(proof)
    // The next renewal proves its session with the verifier of this challenge, for the token's life and five minutes more.
    if (challenge) this.challenges.set(`${minted.name}:${challenge}`, this.now() + (TOKEN_SECONDS + 300) * 1000)
    return { status: 200, body: { token_type: 'Bearer', expires_in: TOKEN_SECONDS, access_token: token.access } }
  }
}

/** A path the routes take: site-relative, with no backslash, as Canvas's own check reads it. */
const validPath = (path: unknown): string | undefined => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : undefined
