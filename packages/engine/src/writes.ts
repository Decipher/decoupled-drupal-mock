import type { Identity, Session } from './identity.js'
import type { Store } from './store.js'
import type { Resource, ResourceIdentifier } from './types.js'

export interface WriteError { status: number, title: string, detail: string, pointer?: string }

const attributesOf = (resource: Resource | undefined): Record<string, unknown> => (resource?.attributes || {}) as Record<string, unknown>

/** The field definitions of a bundle, from the dump's `field_config` and `field_storage_config`. */
export interface FieldDefinition { name: string, type: string, required: boolean, cardinality: number, reference?: boolean }

/** A node's fields only someone who may administer nodes sets. */
const OWNER_FIELDS = ['uid', 'revision_uid', 'created', 'status', 'promote', 'sticky', 'revision_timestamp', 'revision_log']

/**
 * Drupal's rules for creating, updating and deleting content through JSON:API: which permissions, which fields are
 * required, which are read only, and what a new entity gets.
 */
export class Writes {
  constructor(private readonly store: Store, private readonly identity: Identity, private readonly langcode: string) {}

  private config(type: string): Resource[] {
    return this.store.get(this.langcode, type) || []
  }

  /** A bundle's configured fields. */
  fields(entityType: string, bundle: string): FieldDefinition[] {
    const storages = new Map(this.config('field_storage_config--field_storage_config').map((storage) => [`${attributesOf(storage).entity_type}.${attributesOf(storage).field_name}`, storage]))
    return this.config('field_config--field_config')
      .filter((field) => attributesOf(field).entity_type === entityType && attributesOf(field).bundle === bundle)
      // Layout Builder's section field is internal: JSON:API never shows it.
      .filter((field) => attributesOf(field).field_type !== 'layout_section' && attributesOf(field).field_name !== 'layout_builder__layout')
      .map((field) => {
        const attributes = attributesOf(field)
        const storage = attributesOf(storages.get(`${entityType}.${attributes.field_name}`))
        const type = String(attributes.field_type || storage.type || 'string')
        return { name: String(attributes.field_name), type, required: !!attributes.required, cardinality: Number(storage.cardinality ?? 1), reference: ['entity_reference', 'image', 'file', 'entity_reference_revisions'].includes(type) }
      })
  }

  /** The base fields a bundle requires, as Drupal's entity types define them. */
  private requiredBase(entityType: string): string[] {
    return ({ node: ['title'], taxonomy_term: ['name'], block_content: ['info'], menu_link_content: ['title', 'link'], user: ['name'], media: [], contact_message: ['subject', 'message'], path_alias: ['path', 'alias'] } as Record<string, string[]>)[entityType] || []
  }

  /** The workflow moderating a bundle, if one does. */
  private workflow(entityType: string, bundle: string): Resource | undefined {
    return this.config('workflow--workflow').find((workflow) => {
      const settings = attributesOf(workflow).type_settings as { entity_types?: Record<string, string[]> } | undefined
      return settings?.entity_types?.[entityType]?.includes(bundle)
    })
  }

  /** Whether the session may create a bundle. */
  canCreate(session: Session, entityType: string, bundle: string): boolean {
    const { admin, has } = this.identity.permissions(session)
    if (admin) return true
    switch (entityType) {
      case 'node': return has('bypass node access') || has(`create ${bundle} content`)
      case 'taxonomy_term': return has('administer taxonomy') || has(`create terms in ${bundle}`)
      case 'media': return has('administer media') || has('create media')
      case 'block_content': return has('administer block content') || has(`create ${bundle} block content`)
      case 'menu_link_content': return has('administer menu')
      case 'contact_message': return has('access site-wide contact form')
      case 'comment': return has('post comments')
      default: return false
    }
  }

  private owns(session: Session, resource: Resource): boolean {
    const owner = resource.relationships?.uid?.data as ResourceIdentifier | null | undefined
    return !!session.user && !!owner && owner.id === session.user.id
  }

  /** Whether the session may update a resource, and the reason Drupal gives when it may not. */
  canUpdate(session: Session, resource: Resource): { allowed: true } | { allowed: false, detail: string } {
    const { admin, has } = this.identity.permissions(session)
    if (admin) return { allowed: true }
    const [entityType, bundle] = resource.type.split('--') as [string, string]
    let allowed = false
    let detail = 'The current user is not allowed to PATCH the selected resource.'
    switch (entityType) {
      case 'node':
        allowed = has('bypass node access') || has(`edit any ${bundle} content`) || (has(`edit own ${bundle} content`) && this.owns(session, resource))
        detail = `The '${this.owns(session, resource) ? `edit own ${bundle} content` : `edit any ${bundle} content`}' permission is required.`
        break
      case 'taxonomy_term': allowed = has('administer taxonomy') || has(`edit terms in ${bundle}`); break
      case 'media': allowed = has('administer media') || has('update any media') || (has('update media') && this.owns(session, resource)); break
      case 'block_content': allowed = has('administer block content') || has(`edit any ${bundle} block content`); break
      case 'menu_link_content': allowed = has('administer menu'); break
      case 'user': allowed = has('administer users') || (!!session.user && session.user.id === resource.id); break
      default: allowed = false
    }
    // A moderated bundle asks for a transition the user may use, and content moderation answers before node access does.
    const workflow = this.workflow(entityType, bundle)
    if (workflow) {
      const id = String(attributesOf(workflow).drupal_internal__id)
      const transitions = Object.keys(((attributesOf(workflow).type_settings as { transitions?: Record<string, unknown> } | undefined)?.transitions) || {})
      if (!transitions.some((transition) => has(`use ${id} transition ${transition}`))) return { allowed: false, detail: 'No valid transitions exist for given account.' }
    }
    if (!allowed) return { allowed: false, detail }
    return { allowed: true }
  }

  /** Whether the session may delete a resource, and the reason Drupal gives when it may not. */
  canDelete(session: Session, resource: Resource): { allowed: true } | { allowed: false, detail: string } {
    const { admin, has } = this.identity.permissions(session)
    if (admin) return { allowed: true }
    const [entityType, bundle] = resource.type.split('--') as [string, string]
    if (entityType === 'node') {
      const allowed = has('bypass node access') || has(`delete any ${bundle} content`) || (has(`delete own ${bundle} content`) && this.owns(session, resource))
      // Node access names the permission the user lacks: the own one for the owner, the any one for the rest.
      return allowed ? { allowed: true } : { allowed: false, detail: `The '${this.owns(session, resource) ? `delete own ${bundle} content` : `delete any ${bundle} content`}' permission is required.` }
    }
    const allowed = ((): boolean => {
      switch (entityType) {
        case 'taxonomy_term': return has('administer taxonomy') || has(`delete terms in ${bundle}`)
        case 'media': return has('administer media') || has('delete any media') || (has('delete media') && this.owns(session, resource))
        case 'block_content': return has('administer block content') || has(`delete any ${bundle} block content`)
        case 'menu_link_content': return has('administer menu')
        default: return false
      }
    })()
    return allowed ? { allowed: true } : { allowed: false, detail: 'The current user is not allowed to DELETE the selected resource.' }
  }

  /** The 422s Drupal answers for the required fields left empty, each its own error. */
  validate(entityType: string, bundle: string, attributes: Record<string, unknown>, relationships: Record<string, unknown>): WriteError[] {
    const missing = (name: string): boolean => {
      const value = attributes[name] ?? (relationships[name] as { data?: unknown } | undefined)?.data
      return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)
    }
    const invalid = (name: string, kind: string): WriteError => ({ status: 422, title: 'Unprocessable Content', detail: `${name}: This value should not be null.`, pointer: `/data/${kind}/${name}` })
    return [
      ...this.requiredBase(entityType).filter(missing).map((name) => invalid(name, 'attributes')),
      ...this.fields(entityType, bundle).filter((field) => field.required && missing(field.name)).map((field) => invalid(field.name, field.reference ? 'relationships' : 'attributes')),
    ]
  }

  /**
   * Content moderation's answer to a move between states: the transition must exist and the session must hold it.
   *
   * @param session - Who asks.
   * @param entityType - The entity type.
   * @param bundle - The bundle.
   * @param from - The state the entity is in, or the workflow's default for a new one.
   * @param to - The state asked for.
   * @returns The 422 Drupal answers, or nothing when the move is allowed or the bundle is not moderated.
   */
  refusedTransition(session: Session, entityType: string, bundle: string, from: string | undefined, to: unknown): WriteError | undefined {
    const workflow = this.workflow(entityType, bundle)
    if (!workflow) return undefined
    const settings = attributesOf(workflow).type_settings as { default_moderation_state?: string, states?: Record<string, { label?: string }>, transitions?: Record<string, { from?: string[], to?: string }> } | undefined
    const source = from ?? settings?.default_moderation_state ?? 'draft'
    const refuse = (detail: string): WriteError => ({ status: 422, title: 'Unprocessable Content', detail: `moderation_state: ${detail}`, pointer: '/data/attributes/moderation_state' })
    const label = (state: string): string => settings?.states?.[state]?.label || state
    if (!settings?.states?.[String(to)]) return refuse(`State ${String(to)} does not exist on ${String(attributesOf(workflow).label || attributesOf(workflow).drupal_internal__id)} workflow`)
    const moves = Object.entries(settings.transitions || {}).filter(([, transition]) => transition.to === to && transition.from?.includes(source))
    if (!moves.length) return refuse(`Invalid state transition from ${label(source)} to ${label(String(to))}`)
    const { has } = this.identity.permissions(session)
    const id = String(attributesOf(workflow).drupal_internal__id)
    if (!moves.some(([name]) => has(`use ${id} transition ${name}`))) return refuse(`You do not have access to transition from ${label(source)} to ${label(String(to))}`)
    return undefined
  }

  /** A field a POST may not set, as Drupal answers it: an id, the published flag of a moderated bundle, an owner's field. */
  refusedOnCreate(session: Session, entityType: string, bundle: string, name: string): WriteError | undefined {
    const refuse = (explanation = ''): WriteError => ({ status: 403, title: 'Forbidden', detail: `The current user is not allowed to POST the selected field (${name}).${explanation}`, pointer: `/data/attributes/${name}` })
    if (name in this.readOnly(entityType)) return refuse(name === 'uuid' ? ' The entity UUID cannot be changed.' : ' The entity ID cannot be changed.')
    if (name === 'status' && this.workflow(entityType, bundle)) return refuse(' Cannot edit the published field of moderated entities.')
    const { admin, has } = this.identity.permissions(session)
    if (entityType === 'node' && !admin && !has('administer nodes') && OWNER_FIELDS.includes(name)) return refuse()
    return undefined
  }

  /** Why a relationship may not be written through its own route, as Drupal says it. */
  refusedRelationship(session: Session, resource: Resource, name: string): string | undefined {
    const [entityType] = resource.type.split('--') as [string]
    const { admin, has } = this.identity.permissions(session)
    if (entityType === 'node' && OWNER_FIELDS.includes(name) && !admin && !has('administer nodes')) return "The current user is not allowed to edit this relationship. The 'administer nodes' permission is required."
    if (entityType === 'user' && name === 'roles' && !admin && !has('administer users')) return 'The current user is not allowed to edit this relationship.'
    return undefined
  }

  /** The id and uuid fields a PATCH may not change, by the name Drupal uses in its answer. */
  private readOnly(entityType: string): Record<string, string> {
    const id = ({ node: 'nid', taxonomy_term: 'tid', media: 'mid', user: 'uid', block_content: 'id', menu_link_content: 'id', comment: 'cid' } as Record<string, string>)[entityType] || 'id'
    const revision = ({ node: 'vid', media: 'vid', block_content: 'revision_id', taxonomy_term: 'revision_id', menu_link_content: 'revision_id' } as Record<string, string>)[entityType]
    return { [`drupal_internal__${id}`]: id, ...(revision ? { [`drupal_internal__${revision}`]: revision } : {}), uuid: 'uuid' }
  }

  /** A field the session may not change, as Drupal answers a PATCH. */
  refusedField(session: Session, resource: Resource, name: string): WriteError | undefined {
    const [entityType] = resource.type.split('--') as [string]
    const readOnly = this.readOnly(entityType)
    if (name in readOnly) {
      const explanation = readOnly[name] === 'uuid' ? ' The entity UUID cannot be changed.' : name.startsWith('drupal_internal__') && readOnly[name] !== (entityType === 'node' ? 'vid' : 'revision_id') ? ' The entity ID cannot be changed.' : ''
      return { status: 403, title: 'Forbidden', detail: `The current user is not allowed to PATCH the selected field (${readOnly[name]}).${explanation}`, pointer: `/data/attributes/${readOnly[name]}` }
    }
    const [, bundle] = resource.type.split('--') as [string, string]
    if (name === 'status' && this.workflow(entityType, bundle)) return { status: 403, title: 'Forbidden', detail: 'The current user is not allowed to PATCH the selected field (status). Cannot edit the published field of moderated entities.', pointer: '/data/attributes/status' }
    const { admin, has } = this.identity.permissions(session)
    // A user's roles are the administrator's to give, or anyone could give themselves any.
    if (entityType === 'user' && name === 'roles' && !admin && !has('administer users')) return { status: 403, title: 'Forbidden', detail: 'The current user is not allowed to PATCH the selected field (roles).', pointer: '/data/attributes/roles' }
    const owner = OWNER_FIELDS.includes(name)
    if (owner && entityType === 'node' && !admin && !has('administer nodes')) return { status: 403, title: 'Forbidden', detail: `The current user is not allowed to PATCH the selected field (${name}).`, pointer: `/data/${name === 'uid' || name === 'revision_uid' ? 'relationships' : 'attributes'}/${name}` }
    return undefined
  }

  /** A base field's default for a bundle, from `base_field_override`, such as an article's `promote`. */
  private baseDefault(entityType: string, bundle: string, field: string): unknown {
    const override = this.config('base_field_override--base_field_override').find((candidate) => attributesOf(candidate).entity_type === entityType && attributesOf(candidate).bundle === bundle && attributesOf(candidate).field_name === field)
    const values = attributesOf(override).default_value as Array<{ value?: unknown }> | undefined
    return values?.[0]?.value
  }

  /** The bundle's config entity, such as `node_type--node_type` for a node. */
  private bundleEntity(entityType: string, bundle: string): Resource | undefined {
    const typeOf: Record<string, string> = { node: 'node_type--node_type', taxonomy_term: 'taxonomy_vocabulary--taxonomy_vocabulary', media: 'media_type--media_type', block_content: 'block_content_type--block_content_type', comment: 'comment_type--comment_type', contact_message: 'contact_form--contact_form' }
    const type = typeOf[entityType]
    // A node type's machine name is `drupal_internal__type` and a vocabulary's `drupal_internal__vid`; the others keep `drupal_internal__id`.
    const key = entityType === 'node' ? 'drupal_internal__type' : entityType === 'taxonomy_term' ? 'drupal_internal__vid' : 'drupal_internal__id'
    return type ? this.config(type).find((candidate) => attributesOf(candidate)[key] === bundle) : undefined
  }

  /** A new resource of a bundle, as Drupal writes one from a POST. */
  create(session: Session, entityType: string, bundle: string, attributes: Record<string, unknown>, relationships: Record<string, NonNullable<Resource['relationships']>[string]>, now = new Date()): Resource {
    const type = `${entityType}--${bundle}`
    const stamp = now.toISOString().replace(/\.\d{3}Z$/, '+00:00')
    const user: ResourceIdentifier = session.user ? { type: 'user--user', id: session.user.id, meta: { drupal_internal__target_id: session.uid } } : { type: 'user--user', id: this.identity.userNamed('anonymous')?.id || '00000000-0000-0000-0000-000000000000', meta: { drupal_internal__target_id: 0 } }
    const workflow = this.workflow(entityType, bundle)
    const base: Record<string, unknown> = {}
    const rels: NonNullable<Resource['relationships']> = {}
    const bundleEntity = this.bundleEntity(entityType, bundle)
    const bundleRelationship = (name: string) => {
      if (bundleEntity) rels[name] = { data: { type: bundleEntity.type, id: bundleEntity.id, meta: { drupal_internal__target_id: bundle } } }
    }
    const moderation = workflow ? String(((attributesOf(workflow).type_settings as { default_moderation_state?: string } | undefined)?.default_moderation_state) || 'draft') : undefined
    const published = workflow ? moderation === 'published' : true
    switch (entityType) {
      case 'node': {
        const nid = this.store.nextId(this.langcode, 'node', 'drupal_internal__nid')
        const vid = this.store.nextId(this.langcode, 'node', 'drupal_internal__vid')
        Object.assign(base, { drupal_internal__nid: nid, drupal_internal__vid: vid, langcode: this.langcode, revision_timestamp: stamp, revision_log: null, status: published, title: attributes.title, created: stamp, changed: stamp, promote: attributes.promote ?? !!(this.baseDefault('node', bundle, 'promote') ?? false), sticky: attributes.sticky ?? !!(this.baseDefault('node', bundle, 'sticky') ?? false), default_langcode: true, revision_translation_affected: true, ...(moderation ? { moderation_state: moderation } : {}), path: { alias: null, pid: null, langcode: this.langcode }, content_translation_source: 'und', content_translation_outdated: false })
        bundleRelationship('node_type')
        rels.revision_uid = { data: user }
        rels.uid = { data: user }
        break
      }
      case 'taxonomy_term': {
        const tid = this.store.nextId(this.langcode, 'taxonomy_term', 'drupal_internal__tid')
        Object.assign(base, { drupal_internal__tid: tid, drupal_internal__revision_id: tid, langcode: this.langcode, revision_created: stamp, revision_log_message: null, status: true, name: attributes.name, description: null, weight: 0, changed: stamp, default_langcode: true, revision_translation_affected: true, path: { alias: null, pid: null, langcode: this.langcode } })
        bundleRelationship('vid')
        rels.revision_user = { data: null }
        rels.parent = { data: [{ type: 'taxonomy_term--' + bundle, id: 'virtual', meta: { drupal_internal__target_id: 0 } }] }
        break
      }
      case 'media': {
        const mid = this.store.nextId(this.langcode, 'media', 'drupal_internal__mid')
        Object.assign(base, { drupal_internal__mid: mid, drupal_internal__vid: mid, langcode: this.langcode, revision_created: stamp, revision_log_message: null, status: true, name: attributes.name, created: stamp, changed: stamp, default_langcode: true, revision_translation_affected: true, path: { alias: null, pid: null, langcode: this.langcode } })
        bundleRelationship('bundle')
        rels.revision_user = { data: user }
        rels.uid = { data: user }
        break
      }
      case 'contact_message': {
        // As Contact Storage answers a visitor's message: stored with an id and the sender's address, and no copy asked for.
        const id = this.store.nextId(this.langcode, 'contact_message', 'drupal_internal__id')
        Object.assign(base, { drupal_internal__id: id, langcode: this.langcode, name: attributes.name ?? null, mail: attributes.mail ?? null, subject: attributes.subject, message: attributes.message, copy: attributes.copy ?? null, created: stamp, ip_address: '127.0.0.1' })
        bundleRelationship('contact_form')
        rels.recipient = { data: null }
        // Drupal names the anonymous sender as a missing target, typed as the form the message was sent with.
        rels.uid = { data: session.user ? user : { type: 'contact_form--contact_form', id: 'missing', meta: { links: { help: { href: 'https://www.drupal.org/docs/8/modules/json-api/core-concepts#missing', meta: { about: "Usage and meaning of the 'missing' resource identifier." } } } } } }
        break
      }
      case 'menu_link_content': {
        const id = this.store.nextId(this.langcode, 'menu_link_content', 'drupal_internal__id')
        Object.assign(base, { drupal_internal__id: id, drupal_internal__revision_id: id, langcode: this.langcode, revision_created: stamp, enabled: true, title: attributes.title, description: null, menu_name: attributes.menu_name ?? 'main', link: attributes.link, external: false, rediscover: false, weight: 0, expanded: false, parent: null, changed: stamp, default_langcode: true, revision_translation_affected: true })
        rels.revision_user = { data: user }
        break
      }
      default: {
        Object.assign(base, { langcode: this.langcode, status: true, changed: stamp })
      }
    }
    // Every field of the bundle, empty, then what the request set.
    for (const field of this.fields(entityType, bundle)) {
      if (field.reference) rels[field.name] = { data: field.cardinality === 1 ? null : [] }
      else base[field.name] = field.cardinality === 1 ? null : []
    }
    for (const [name, value] of Object.entries(attributes)) if (!(name in rels)) base[name] = value
    // A state asked for sets the published flag, as content moderation does.
    const state = (attributesOf(workflow).type_settings as { states?: Record<string, { published?: boolean }> } | undefined)?.states?.[String(base.moderation_state)]
    if (state?.published !== undefined) base.status = state.published
    for (const [name, value] of Object.entries(relationships)) if (value) rels[name] = { data: this.withMeta(value.data) }
    return { type, id: this.identity.uuid(), attributes: base, relationships: rels }
  }

  /** Identifiers with `meta.drupal_internal__target_id`, as Drupal writes a relationship. */
  withMeta<T extends ResourceIdentifier | ResourceIdentifier[] | null>(data: T): T {
    const one = (identifier: ResourceIdentifier): ResourceIdentifier => {
      if (identifier.meta?.drupal_internal__target_id !== undefined) return identifier
      const target = (this.store.get(this.langcode, identifier.type) || []).find((candidate) => candidate.id === identifier.id)
      const attributes = attributesOf(target)
      const internal = attributes.drupal_internal__nid ?? attributes.drupal_internal__tid ?? attributes.drupal_internal__uid ?? attributes.drupal_internal__mid ?? attributes.drupal_internal__fid ?? attributes.drupal_internal__id
      return internal === undefined ? identifier : { ...identifier, meta: { ...(identifier.meta || {}), drupal_internal__target_id: internal } }
    }
    if (Array.isArray(data)) return data.map(one) as T
    return (data ? one(data) : data) as T
  }

  /** Content moderation sets the published flag from the state a PATCH moves to. */
  publishedFor(entityType: string, bundle: string, state: string): boolean | undefined {
    const workflow = this.workflow(entityType, bundle)
    const states = (attributesOf(workflow).type_settings as { states?: Record<string, { published?: boolean }> } | undefined)?.states
    return states?.[state]?.published
  }
}
