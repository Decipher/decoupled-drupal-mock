/** A JSON:API resource identifier. */
export interface ResourceIdentifier { type: string, id: string, meta?: Record<string, unknown> }

/** A resource as Drupal serialises it in an individual response. */
export interface Resource {
  type: string
  id: string
  links?: Record<string, { href: string }>
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data: ResourceIdentifier | ResourceIdentifier[] | null, links?: Record<string, { href: string }> }>
  meta?: Record<string, unknown>
}

/** A JSON:API document. */
export interface Document {
  jsonapi?: { version: string, meta?: Record<string, unknown> }
  data?: Resource | Resource[] | ResourceIdentifier | ResourceIdentifier[] | null
  included?: Resource[]
  links?: Record<string, { href: string } | null>
  meta?: Record<string, unknown>
  errors?: Array<{ title: string, status: string, detail?: string, links?: Record<string, { href: string }>, source?: Record<string, string> }>
}

/** A response recorded from Drupal for a route the engine does not compute. */
export interface Recorded { status: number, headers: Record<string, string>, body: unknown }

/** The manifest of a preset build. */
export interface Manifest {
  preset: string
  /** The dump's layout, which an engine checks it can read. A manifest without one is format 1. */
  format?: number
  /** What the build recorded: Drupal's version, every contributed module's, and any patch that no release of a module holds. */
  drupal: { core: string, profile: string, modules: Record<string, string>, patches?: Record<string, string[]> }
  built: string
  /** The origin every absolute URL in the dump was rewritten to. */
  origin: string
  /** The languages the dump holds, as `langcode` to URL prefix (`''` for the default language). */
  languages: Record<string, string>
  /** The default langcode. */
  defaultLanguage: string
  files: Record<string, string>
  /** The hash of each recording of the oracle, kept beside the dump and not in it. */
  oracle?: Record<string, string>
  /**
   * The cache headers the site sends: `public` with an answer its page cache may keep, `private` with one it never
   * keeps. Each holds `cache-control`, `vary` and `expires` as the site sent them. A dump built before them has none.
   */
  cache?: { public: Record<string, string>, private: Record<string, string> }
}

/** A preset build, in memory. */
export interface Dump {
  manifest: Manifest
  /** The JSON:API index per langcode, as Drupal serves it. */
  index: Record<string, Document>
  /** Every resource per langcode, by resource type, as its individual response's `data`. */
  resources: Record<string, Record<string, Resource[]>>
  /** Recorded routes keyed by `METHOD path?sorted=query`. */
  recorded: Record<string, Recorded>
  /**
   * Per langcode and type, what the anonymous user may read: the ids it may, or that it may not list the type at all.
   * A type not named is readable in full. A request with an Authorization header reads everything.
   */
  /** The accounts and consumers the mock signs in, from the build's configuration. */
  identities?: { accounts: Array<{ name: string, password?: string, roles?: string[] }>, consumers: Array<{ clientId: string, secret?: string, confidential?: boolean, grants: Array<'client_credentials' | 'password' | 'authorization_code' | 'refresh_token'>, scopes?: Record<string, string>, user?: string, pkce?: boolean, redirectUris?: string[] }>, passwordGrant?: boolean }
  /** What Drupal answered the build's filter probes, per resource type: a dump built before them has none. */
  filters?: Record<string, TypeFilters>
  access?: Record<string, Record<string, {
    visible?: string[]
    hidden?: string[]
    forbidden?: true
    /** Resources Drupal reports as omitted to every user, so no view holds their data: they take a place in a collection and are reported, never served. */
    phantom?: string[]
    /**
     * A type no module lets a visitor filter, so JSON:API answers any filtered collection of it with nothing. A content
     * entity type is filterable only where a module implements `hook_jsonapi_ENTITY_TYPE_filter_access()`.
     */
    unfilterable?: true
  }>>
}

/** What the build learned of a type's filter paths by asking Drupal, as `filters.json.gz` holds it. */
export interface TypeFilters {
  /** A configuration entity type: Drupal checks only that a path's first field exists. */
  config?: true
  /** The fields a visitor may not filter or sort by. */
  refused?: string[]
  /** The fields Drupal says do not exist, although resources carry them. */
  missing?: string[]
  /** Each field a path may not end at, with what it must end with instead, in Drupal's order. */
  specifiers?: Record<string, string[]>
  /** Drupal's 500 for a field, or a field and one of its specifiers, keyed `field` or `field.specifier`. */
  failures?: Record<string, string>
}
