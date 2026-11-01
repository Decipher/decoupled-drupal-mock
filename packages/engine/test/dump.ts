import type { Dump, Resource } from '../src/types'

/** A tiny Umami-shaped dump written for the tests: two pages, a recipe, a user and a file, in English and Spanish. */
export const ORIGIN = 'https://drupal.invalid'

const link = (path: string) => ({ href: `${ORIGIN}${path}` })

export const user: Resource = { type: 'user--user', id: 'u-1', attributes: { display_name: 'Umami', name: 'umami' }, relationships: {} }
export const file: Resource = { type: 'file--file', id: 'f-1', attributes: { filename: 'quiche.jpg', uri: { value: 'public://quiche.jpg', url: '/sites/default/files/quiche.jpg' } }, relationships: { uid: { data: { type: 'user--user', id: 'u-1' } } } }
export const image: Resource = { type: 'media--image', id: 'm-1', attributes: { name: 'Quiche' }, relationships: { field_media_image: { data: { type: 'file--file', id: 'f-1', meta: { alt: 'A quiche', drupal_internal__target_id: 1 } } }, uid: { data: { type: 'user--user', id: 'u-1' } } } }

const node = (id: string, bundle: string, nid: number, title: string, extra: Record<string, unknown> = {}, relationships: Resource['relationships'] = {}): Resource => ({
  type: `node--${bundle}`,
  id,
  links: { self: link(`/jsonapi/node/${bundle}/${id}?resourceVersion=id%3A${nid}`) },
  attributes: { drupal_internal__nid: nid, langcode: 'en', status: true, title, created: `2026-01-0${nid}T00:00:00+00:00`, path: { alias: `/${bundle}/${title.toLowerCase().replace(/\s+/g, '-')}`, langcode: 'en' }, ...extra },
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
    en: { 'node--page': pages, 'node--recipe': recipes, 'user--user': [user], 'file--file': [file], 'media--image': [image], 'taxonomy_term--tags': tags, 'block--block': blocks },
    // Spanish translates the first recipe only; the rest fall back to English.
    es: { 'node--recipe': [spanish(recipes[0]!, 'Quiche mediterráneo profundo')] },
  },
  recorded: {
    'GET /router/translate-path?path=%2Fabout-umami': { status: 200, headers: { 'content-type': 'application/json' }, body: { resolved: `${ORIGIN}/about-umami`, isHomePath: false, entity: { canonical: `${ORIGIN}/about-umami`, type: 'node', bundle: 'page', id: '1', uuid: 'p-1' }, label: 'About Umami', jsonapi: { individual: `${ORIGIN}/jsonapi/node/page/p-1`, resourceName: 'node--page', basePath: '/jsonapi', entryPoint: `${ORIGIN}/jsonapi` } } },
    'GET /jsonapi/menu_items/main': { status: 200, headers: { 'content-type': 'application/vnd.api+json' }, body: { jsonapi: { version: '1.0' }, data: [{ type: 'menu_link_content--menu_link_content', id: 'ml-1', attributes: { title: 'Home', url: '/' } }] } },
  },
}
