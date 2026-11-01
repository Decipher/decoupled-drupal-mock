import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Dump, Resource } from './types.js'

/** An account the mock signs in: a user of the dump, with the password its build gave it. */
export interface Account { name: string, password?: string, roles?: string[] }

/** A consumer, as Simple OAuth configures one. */
export interface Consumer {
  clientId: string
  secret?: string
  confidential?: boolean
  grants: Array<'client_credentials' | 'password' | 'authorization_code' | 'refresh_token'>
  /** The scopes the consumer may ask for, each giving a role. */
  scopes?: Record<string, string>
  /** The user a client credentials grant acts as. */
  user?: string
  pkce?: boolean
}

/** The identities a preset knows, from its build's configuration. */
export interface Identities {
  accounts: Account[]
  consumers: Consumer[]
  /** Whether the Drupal has the password grant installed. Simple OAuth 6 ships it as its own module, and without it a password grant is refused. Default true. */
  passwordGrant?: boolean
}

/** Who a request is, once its credentials are read. */
export interface Session {
  /** The user resource, or none for the anonymous user. */
  user?: Resource
  uid: number
  /** The role ids, `anonymous` or `authenticated` and the rest. */
  roles: string[]
  /** The scopes a token carried, which limit its roles. */
  scopes?: string[]
}

export interface Token { access: string, refresh?: string, name: string, roles: string[], scopes?: string[], clientId: string, issued: number, expires: number }

export const ANONYMOUS: Session = { uid: 0, roles: ['anonymous'] }

const base64url = (bytes: Buffer): string => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A token in the shape of Simple OAuth's JWTs: three dot-separated parts, so a client that checks the shape is content. */
const mint = (): string => `${base64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })))}.${base64url(randomBytes(48))}.${base64url(randomBytes(32))}`

/**
 * The mock's users, roles, consumers and tokens. Tokens live with the instance: a test signs in, and its tokens go
 * when the instance does.
 */
export class Identity {
  private readonly tokens = new Map<string, Token>()
  private readonly refreshes = new Map<string, Token>()
  private readonly codes = new Map<string, { clientId: string, name: string, scopes?: string[], challenge?: string, method?: string, redirectUri: string }>()
  private readonly cookies = new Map<string, { name: string, csrf: string }>()

  constructor(private readonly dump: Dump, private readonly identities: Identities, private readonly users: () => Resource[], private readonly roleIds: () => Map<string, Resource>) {}

  /** A user of the dump by name. */
  userNamed(name: string): Resource | undefined {
    return this.users().find((user) => (user.attributes as { name?: string } | undefined)?.name === name)
  }

  private sessionFor(user: Resource, scopes?: string[]): Session {
    const roleIds = ((user.relationships?.roles?.data as Array<{ id: string }> | undefined) || []).map((identifier) => identifier.id)
    const byUuid = this.roleIds()
    const roles = roleIds.map((id) => (byUuid.get(id)?.attributes as { drupal_internal__id?: string } | undefined)?.drupal_internal__id).filter((role): role is string => !!role)
    const scoped = scopes?.length ? scopes.map((scope) => this.scopeRole(scope)).filter((role): role is string => !!role) : undefined
    return { user, uid: Number((user.attributes as { drupal_internal__uid?: number }).drupal_internal__uid), roles: ['authenticated', ...(scoped || roles)], ...(scopes ? { scopes } : {}) }
  }

  private scopeRole(scope: string): string | undefined {
    for (const consumer of this.identities.consumers) if (consumer.scopes?.[scope]) return consumer.scopes[scope]
    return undefined
  }

  /** The session a request's headers name, or the anonymous one; a bad token is an error to answer with 401. */
  session(headers: Record<string, string>): Session | { invalid: string } {
    const authorization = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
    if (authorization) {
      const [scheme, value] = authorization.split(/\s+/, 2)
      if (scheme?.toLowerCase() !== 'bearer' || !value) return { invalid: 'The JWT string must have two dots' }
      const token = this.tokens.get(value)
      if (!token) return { invalid: value.split('.').length === 3 ? 'The JWT string is invalid' : 'The JWT string must have two dots' }
      if (token.expires < Date.now()) return { invalid: 'The access token has expired' }
      const user = this.userNamed(token.name)
      return user ? this.sessionFor(user, token.scopes) : ANONYMOUS
    }
    const cookie = Object.entries(headers).find(([name]) => name.toLowerCase() === 'cookie')?.[1]
    const session = cookie?.match(/(?:^|;\s*)SESS[0-9a-f]+=([^;]+)/)?.[1]
    const signedIn = session ? this.cookies.get(session) : undefined
    if (signedIn) {
      const user = this.userNamed(signedIn.name)
      if (user) return this.sessionFor(user)
    }
    return ANONYMOUS
  }

  /** A token for a user, past the grant: a test's shortcut. */
  tokenFor(name: string, scopes?: string[]): Token {
    if (!this.userNamed(name)) throw new Error(`No user named "${name}" in the ${this.dump.manifest.preset} preset.`)
    return this.issue({ clientId: 'mock', name, scopes, refresh: true })
  }

  private issue({ clientId, name, scopes, refresh }: { clientId: string, name: string, scopes?: string[] | undefined, refresh: boolean }): Token {
    const user = this.userNamed(name)!
    const roles = this.sessionFor(user, scopes).roles
    const token: Token = { access: mint(), ...(refresh ? { refresh: mint() } : {}), name, roles, ...(scopes ? { scopes } : {}), clientId, issued: Date.now(), expires: Date.now() + 300_000 }
    this.tokens.set(token.access, token)
    if (token.refresh) this.refreshes.set(token.refresh, token)
    return token
  }

  /** `POST /oauth/token`, as Simple OAuth answers it: a token document or league's error. */
  grant(form: URLSearchParams): { status: number, body: Record<string, unknown> } {
    const grantType = form.get('grant_type') || ''
    const clientId = form.get('client_id') || ''
    const consumer = this.identities.consumers.find((candidate) => candidate.clientId === clientId)
    const fail = (status: number, error: string, description: string, hint?: string) => ({ status, body: { error, error_description: description, ...(hint ? { hint } : {}) } })
    if (!consumer || (consumer.confidential && consumer.secret !== form.get('client_secret'))) return fail(401, 'invalid_client', 'Client authentication failed')
    if (!(consumer.grants as string[]).includes(grantType)) return fail(400, 'unsupported_grant_type', 'The authorization grant type is not supported by the authorization server.', 'Check that all required parameters have been provided')
    const scopes = (form.get('scope') || '').split(/\s+/).filter(Boolean)
    for (const scope of scopes) if (!consumer.scopes?.[scope]) return fail(400, 'invalid_scope', 'The requested scope is invalid, unknown, or malformed', `Check the \`${scope}\` scope`)
    const answer = (token: Token) => ({ status: 200, body: { token_type: 'Bearer', expires_in: 300, access_token: token.access, ...(token.refresh ? { refresh_token: token.refresh } : {}) } })
    switch (grantType) {
      case 'client_credentials': {
        const name = consumer.user || this.identities.accounts[0]?.name
        if (!name || !this.userNamed(name)) return fail(401, 'invalid_client', 'Client authentication failed')
        return answer(this.issue({ clientId, name, scopes: scopes.length ? scopes : undefined, refresh: false }))
      }
      case 'password': {
        if (this.identities.passwordGrant === false) return fail(400, 'invalid_grant', 'The provided authorization grant (e.g., authorization code, resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.', 'Grant type is not installed.')
        const account = this.identities.accounts.find((candidate) => candidate.name === form.get('username'))
        if (!account || account.password === undefined || account.password !== form.get('password')) return fail(400, 'invalid_grant', 'The user credentials were incorrect.')
        return answer(this.issue({ clientId, name: account.name, scopes: scopes.length ? scopes : undefined, refresh: true }))
      }
      case 'refresh_token': {
        const held = this.refreshes.get(form.get('refresh_token') || '')
        if (!held || held.clientId !== clientId) return fail(400, 'invalid_grant', 'The refresh token is invalid.', 'Token is not linked to client')
        this.refreshes.delete(held.refresh!)
        this.tokens.delete(held.access)
        return answer(this.issue({ clientId, name: held.name, scopes: held.scopes, refresh: true }))
      }
      case 'authorization_code': {
        const code = this.codes.get(form.get('code') || '')
        if (!code || code.clientId !== clientId) return fail(400, 'invalid_grant', 'Authorization code has expired', 'Cannot decrypt the authorization code')
        if (code.redirectUri !== form.get('redirect_uri')) return fail(400, 'invalid_request', 'The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed.', 'Check the `redirect_uri` parameter')
        if (code.challenge) {
          const verifier = form.get('code_verifier') || ''
          const expected = code.method === 'S256' ? base64url(createHash('sha256').update(verifier).digest()) : verifier
          if (expected !== code.challenge) return fail(400, 'invalid_grant', 'Authorization code has expired', 'Failed to verify `code_verifier`.')
        }
        this.codes.delete(form.get('code')!)
        return answer(this.issue({ clientId, name: code.name, scopes: code.scopes, refresh: true }))
      }
      default:
        return fail(400, 'unsupported_grant_type', 'The authorization grant type is not supported by the authorization server.', 'Check that all required parameters have been provided')
    }
  }

  /** `GET /oauth/authorize`: a redirect with a code for a signed-in cookie, else Drupal's 400 for a request it cannot grant. */
  authorize(query: Record<string, unknown>, session: Session): { status: number, location?: string } {
    const clientId = String(query.client_id || '')
    const consumer = this.identities.consumers.find((candidate) => candidate.clientId === clientId)
    const redirectUri = String(query.redirect_uri || '')
    if (!consumer || !consumer.grants.includes('authorization_code') || !redirectUri || query.response_type !== 'code') return { status: 400 }
    if (consumer.pkce && !query.code_challenge) return { status: 400 }
    if (!session.user) return { status: 403 }
    const code = base64url(randomBytes(32))
    const scopes = String(query.scope || '').split(/\s+/).filter(Boolean)
    this.codes.set(code, { clientId, name: String((session.user.attributes as { name?: string }).name), ...(scopes.length ? { scopes } : {}), ...(query.code_challenge ? { challenge: String(query.code_challenge), method: String(query.code_challenge_method || 'plain') } : {}), redirectUri })
    const url = new URL(redirectUri)
    url.searchParams.set('code', code)
    if (query.state) url.searchParams.set('state', String(query.state))
    return { status: 302, location: url.toString() }
  }

  /** `GET /oauth/userinfo`: the claims Simple OAuth writes for the signed-in user. */
  userinfo(session: Session, baseUrl: string, prefix: string): Record<string, unknown> | undefined {
    if (!session.user) return undefined
    const attributes = session.user.attributes as Record<string, unknown>
    return {
      sub: String(session.uid),
      name: attributes.name,
      preferred_username: attributes.name,
      ...(attributes.mail ? { email: attributes.mail, email_verified: true } : {}),
      profile: `${baseUrl}${prefix}/user/${session.uid}`,
      locale: attributes.preferred_langcode || attributes.langcode || 'en',
      zoneinfo: attributes.timezone || 'UTC',
      updated_at: Math.floor(new Date(String(attributes.changed || 0)).getTime() / 1000) || 0,
    }
  }

  /** `POST /user/login?_format=json`: a cookie session, as Drupal's user module gives one. */
  login(name: string, password: string): { status: number, body: Record<string, unknown>, cookie?: string } {
    const account = this.identities.accounts.find((candidate) => candidate.name === name)
    const user = account && this.userNamed(name)
    if (!account || !user || account.password === undefined || account.password !== password) return { status: 400, body: { message: 'Unrecognized username or password.' } }
    const id = base64url(randomBytes(24))
    const csrf = base64url(randomBytes(32))
    this.cookies.set(id, { name, csrf })
    const attributes = user.attributes as Record<string, unknown>
    return { status: 200, body: { current_user: { uid: String(attributes.drupal_internal__uid), roles: ['authenticated'], name }, csrf_token: csrf, logout_token: base64url(randomBytes(32)) }, cookie: `SESS${createHash('sha256').update(name).digest('hex').slice(0, 32)}=${id}; path=/; HttpOnly; SameSite=Lax` }
  }

  /** The CSRF token of a cookie session, or a fresh one for none, as `GET /session/token` gives it. */
  csrf(headers: Record<string, string>): string {
    const cookie = Object.entries(headers).find(([name]) => name.toLowerCase() === 'cookie')?.[1]
    const session = cookie?.match(/(?:^|;\s*)SESS[0-9a-f]+=([^;]+)/)?.[1]
    return (session && this.cookies.get(session)?.csrf) || base64url(randomBytes(32))
  }

  /** `POST /user/logout`: the cookie session ends. */
  logout(headers: Record<string, string>): void {
    const cookie = Object.entries(headers).find(([name]) => name.toLowerCase() === 'cookie')?.[1]
    const session = cookie?.match(/(?:^|;\s*)SESS[0-9a-f]+=([^;]+)/)?.[1]
    if (session) this.cookies.delete(session)
  }

  /** The permissions a session holds, from its roles as the dump holds them; an administrator role holds every one. */
  permissions(session: Session): { admin: boolean, has: (permission: string) => boolean } {
    const roles = [...this.roleIds().values()].filter((role) => session.roles.includes(String((role.attributes as { drupal_internal__id?: string }).drupal_internal__id)))
    const admin = roles.some((role) => (role.attributes as { is_admin?: boolean }).is_admin)
    const granted = new Set(roles.flatMap((role) => ((role.attributes as { permissions?: string[] }).permissions || [])))
    return { admin, has: (permission) => admin || granted.has(permission) }
  }

  /** A new uuid, for a created resource. */
  uuid(): string {
    return randomUUID()
  }
}
