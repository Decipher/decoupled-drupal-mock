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
  drupal: { core: string, profile: string, modules: Record<string, string> }
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
}

/** A preset build, in memory. */
/** A field of a GraphQL Compose type: its SDL name maps onto a Drupal field. */
export interface ComposeField { field: string, fieldType: string, type: string, multiple: boolean, required: boolean, base: boolean }

/** A GraphQL Compose type for a bundle, with its query names and its fields. */
export interface ComposeType { type: string, single: string, plural: string, interfaces: string[], queryLoad: boolean, routes: boolean, edges: boolean, fields: Record<string, ComposeField> }

/** The GraphQL Compose schema's mapping onto Drupal, as the build recorded it. */
export interface ComposeMeta {
  endpoint: string
  server?: string
  settings?: Record<string, unknown>
  timezone?: string
  types: Record<string, ComposeType>
  /** The site's front page path, such as `/node`. */
  front?: string
  /** Menu machine names to their `MenuAvailable` enum values and their labels per language. */
  menus?: Record<string, { enum: string, labels: Record<string, string> }>
  /** Language labels, per language of the request then language labelled. */
  languages?: Record<string, Record<string, string>>
}

export interface Dump {
  manifest: Manifest
  /** The GraphQL Compose schema as Drupal serves it, and its mapping onto Drupal, when the build's Drupal had one. */
  graphql?: { schema: string, compose: ComposeMeta }
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
  access?: Record<string, Record<string, {
    visible?: string[]
    hidden?: string[]
    forbidden?: true
    /** Resources Drupal reports as omitted to every user, so no view holds their data: they take a place in a collection and are reported, never served. */
    phantom?: string[]
  }>>
}
