import type { Dump, Resource } from '../src/types'

/** A tiny Umami-shaped dump written for the tests: two pages, a recipe, a user and a file, in English and Spanish. */
export const ORIGIN = 'https://drupal.invalid'

const link = (path: string) => ({ href: `${ORIGIN}${path}` })

export const roles: Resource[] = [
  { type: 'user_role--user_role', id: 'role-anon', attributes: { drupal_internal__id: 'anonymous', is_admin: false, permissions: ['access content'] } },
  { type: 'user_role--user_role', id: 'role-auth', attributes: { drupal_internal__id: 'authenticated', is_admin: false, permissions: ['access content'] } },
  { type: 'user_role--user_role', id: 'role-editor', attributes: { drupal_internal__id: 'editor', is_admin: false, permissions: ['create page content', 'edit own page content', 'delete own page content', 'edit any recipe content', 'use editorial transition create_new_draft', 'use editorial transition publish'] } },
  { type: 'user_role--user_role', id: 'role-admin', attributes: { drupal_internal__id: 'administrator', is_admin: true, permissions: [] } },
]
export const user: Resource = { type: 'user--user', id: 'u-1', attributes: { display_name: 'Umami', name: 'umami', mail: 'umami@example.com', drupal_internal__uid: 2, changed: '2026-01-01T00:00:00+00:00', timezone: 'UTC' }, relationships: { roles: { data: [{ type: 'user_role--user_role', id: 'role-editor' }] } } }
export const admin: Resource = { type: 'user--user', id: 'u-admin', attributes: { display_name: 'admin', name: 'admin', mail: 'admin@example.com', drupal_internal__uid: 1, changed: '2026-01-01T00:00:00+00:00' }, relationships: { roles: { data: [{ type: 'user_role--user_role', id: 'role-admin' }] } } }
export const nodeTypes: Resource[] = [
  { type: 'node_type--node_type', id: 'nt-page', attributes: { drupal_internal__id: 'page', name: 'Basic page' } },
  { type: 'node_type--node_type', id: 'nt-recipe', attributes: { drupal_internal__id: 'recipe', name: 'Recipe' } },
]
export const fieldConfigs: Resource[] = [
  { type: 'field_config--field_config', id: 'fc-body', attributes: { field_name: 'body', entity_type: 'node', bundle: 'page', field_type: 'text_with_summary', required: false } },
  { type: 'field_config--field_config', id: 'fc-time', attributes: { field_name: 'field_cooking_time', entity_type: 'node', bundle: 'recipe', field_type: 'integer', required: true } },
  { type: 'field_config--field_config', id: 'fc-tags', attributes: { field_name: 'field_tags', entity_type: 'node', bundle: 'recipe', field_type: 'entity_reference', required: false } },
]
export const fieldStorages: Resource[] = [
  { type: 'field_storage_config--field_storage_config', id: 'fs-tags', attributes: { field_name: 'field_tags', entity_type: 'node', type: 'entity_reference', cardinality: -1 } },
]
export const workflows: Resource[] = [
  { type: 'workflow--workflow', id: 'wf-editorial', attributes: { drupal_internal__id: 'editorial', type_settings: { states: { draft: { label: 'Draft', published: false }, published: { label: 'Published', published: true } }, transitions: { create_new_draft: { from: ['draft', 'published'], to: 'draft' }, publish: { from: ['draft', 'published'], to: 'published' } }, default_moderation_state: 'draft', entity_types: { node: ['recipe'] } } } },
]
export const file: Resource = { type: 'file--file', id: 'f-1', attributes: { filename: 'quiche.jpg', uri: { value: 'public://quiche.jpg', url: '/sites/default/files/quiche.jpg' } }, relationships: { uid: { data: { type: 'user--user', id: 'u-1' } } } }
export const image: Resource = { type: 'media--image', id: 'm-1', attributes: { name: 'Quiche' }, relationships: { field_media_image: { data: { type: 'file--file', id: 'f-1', meta: { alt: 'A quiche', drupal_internal__target_id: 1 } } }, uid: { data: { type: 'user--user', id: 'u-1' } } } }

const node = (id: string, bundle: string, nid: number, title: string, extra: Record<string, unknown> = {}, relationships: Resource['relationships'] = {}): Resource => ({
  type: `node--${bundle}`,
  id,
  links: { self: link(`/jsonapi/node/${bundle}/${id}?resourceVersion=id%3A${nid}`) },
  attributes: { drupal_internal__nid: nid, drupal_internal__vid: nid, langcode: 'en', status: true, title, created: `2026-01-0${nid}T00:00:00+00:00`, path: { alias: `/${bundle}/${title.toLowerCase().replace(/\s+/g, '-')}`, langcode: 'en' }, ...extra },
  relationships: { uid: { data: { type: 'user--user', id: 'u-1' }, links: { related: link(`/jsonapi/node/${bundle}/${id}/uid`) } }, ...relationships },
})

export const pages = [
  node('p-1', 'page', 1, 'About Umami', { body: { value: '<p>About.</p>', format: 'basic_html' }, field_code: '01' }, { field_secret: { data: { type: 'user--user', id: 'u-1' } } }),
  node('p-2', 'page', 2, 'Contact', { status: false, body: null }),
]
export const recipes = [
  node('r-1', 'recipe', 3, 'Deep mediterranean quiche', { field_cooking_time: 30, field_difficulty: 'medium' }, { field_media_image: { data: { type: 'media--image', id: 'm-1' } }, field_tags: { data: [{ type: 'taxonomy_term--tags', id: 't-1' }, { type: 'taxonomy_term--tags', id: 't-2' }] } }),
  node('r-2', 'recipe', 4, 'Borscht', { field_cooking_time: 90, field_difficulty: 'hard' }, { field_media_image: { data: null }, field_tags: { data: [] }, field_related: { data: { type: 'node--recipe', id: 'r-1' } } }),
  node('r-3', 'recipe', 5, 'Fiery chili', { field_cooking_time: 45, field_difficulty: 'easy' }, { field_media_image: { data: null }, field_tags: { data: [{ type: 'taxonomy_term--tags', id: 't-1' }] } }),
]
export const tags: Resource[] = [
  { type: 'taxonomy_term--tags', id: 't-1', attributes: { name: 'Vegetarian', weight: 2 }, relationships: {} },
  { type: 'taxonomy_term--tags', id: 't-2', attributes: { name: 'Baked', weight: 1 }, relationships: {} },
]
export const blocks: Resource[] = [
  { type: 'block--block', id: 'b-1', attributes: { drupal_internal__id: 'umami_branding', theme: 'umami', region: 'header', weight: -10, status: true, plugin: 'system_branding_block', settings: { id: 'system_branding_block', provider: 'system', label_display: '0' } }, relationships: {} },
  { type: 'block--block', id: 'b-2', attributes: { drupal_internal__id: 'umami_disclaimer', theme: 'umami', region: 'footer', weight: 0, status: true, plugin: 'block_content:abc', settings: { id: 'block_content:abc', provider: 'block_content', label_display: 'visible' } }, relationships: {} },
]

const spanish = (resource: Resource, title: string): Resource => ({ ...resource, attributes: { ...resource.attributes, langcode: 'es', title, path: { ...(resource.attributes!.path as object), langcode: 'es' } } })

export const dump: Dump = {
  manifest: {
    preset: 'umami-test',
    drupal: { core: '11.2.3', profile: 'demo_umami', modules: { decoupled_router: '2.0.7' } },
    built: '2026-11-01T00:00:00Z',
    origin: ORIGIN,
    languages: { en: '', es: 'es' },
    defaultLanguage: 'en',
    files: {},
  },
  index: {
    en: { jsonapi: { version: '1.0' }, data: [], links: { self: link('/jsonapi'), 'node--page': link('/jsonapi/node/page'), 'node--recipe': link('/jsonapi/node/recipe') } },
    es: { jsonapi: { version: '1.0' }, data: [], links: { self: link('/es/jsonapi'), 'node--page': link('/es/jsonapi/node/page'), 'node--recipe': link('/es/jsonapi/node/recipe') } },
  },
  resources: {
    en: { 'node--page': pages, 'node--recipe': recipes, 'user--user': [user, admin], 'file--file': [file], 'media--image': [image], 'taxonomy_term--tags': tags, 'block--block': blocks, 'user_role--user_role': roles, 'node_type--node_type': nodeTypes, 'field_config--field_config': fieldConfigs, 'field_storage_config--field_storage_config': fieldStorages, 'workflow--workflow': workflows },
    // Spanish translates the first recipe only; the rest fall back to English.
    es: { 'node--recipe': [spanish(recipes[0]!, 'Quiche mediterráneo profundo')] },
  },
  identities: {
    accounts: [{ name: 'umami', password: 'secret' }, { name: 'admin', password: 'admin' }],
    consumers: [
      { clientId: 'druxt', secret: 's3cret', confidential: true, grants: ['client_credentials', 'password', 'refresh_token'], scopes: { editor: 'editor', administrator: 'administrator' }, user: 'admin' },
      { clientId: 'public', confidential: false, grants: ['authorization_code', 'refresh_token'], pkce: true, redirectUris: ['https://site.test/callback'] },
    ],
  },
  recorded: {
    'GET /router/translate-path?path=%2Fabout-umami': { status: 200, headers: { 'content-type': 'application/json' }, body: { resolved: `${ORIGIN}/about-umami`, isHomePath: false, entity: { canonical: `${ORIGIN}/about-umami`, type: 'node', bundle: 'page', id: '1', uuid: 'p-1' }, label: 'About Umami', jsonapi: { individual: `${ORIGIN}/jsonapi/node/page/p-1`, resourceName: 'node--page', basePath: '/jsonapi', entryPoint: `${ORIGIN}/jsonapi` } } },
    'GET /jsonapi/menu_items/main': { status: 200, headers: { 'content-type': 'application/vnd.api+json' }, body: { jsonapi: { version: '1.0' }, data: [{ type: 'menu_link_content--menu_link_content', id: 'ml-1', attributes: { title: 'Home', url: '/', enabled: true, menu_name: 'main', parent: '' } }, { type: 'menu_link_content--menu_link_content', id: 'ml-2', attributes: { title: 'Recipes', url: '/recipes', enabled: true, menu_name: 'main', parent: '' } }, { type: 'menu_link_content--menu_link_content', id: 'ml-3', attributes: { title: 'Soups', url: '/recipes/soups', enabled: true, menu_name: 'main', parent: 'ml-2' } }, { type: 'menu_link_content--menu_link_content', id: 'ml-4', attributes: { title: 'Old', url: '/old', enabled: false, menu_name: 'main', parent: '' } }] } },
  },
}
