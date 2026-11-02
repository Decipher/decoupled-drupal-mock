import { describe, expect, it } from 'vitest'
import { createDrupal, parseQuery } from '../src'
import type { Document, Resource } from '../src'
import { dump, ORIGIN } from './dump'

const drupal = createDrupal(dump, { baseUrl: 'https://drupal.test' })
const get = async (path: string): Promise<{ status: number, body: Document, headers: Headers }> => {
  const response = await drupal.fetch(`https://drupal.test${path}`)
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text.startsWith('<') ? { meta: { html: text } } : JSON.parse(text) as Document }
}
const ids = (document: Document): string[] => (document.data as Resource[]).map((resource) => resource.id)

describe('the index', () => {
  it('answers under each language prefix with the server\'s own origin in every link', async () => {
    const { status, body, headers } = await get('/jsonapi')
    expect(status).toBe(200)
    expect(headers.get('content-type')).toBe('application/vnd.api+json')
    expect(body.links!['node--page']).toEqual({ href: 'https://drupal.test/jsonapi/node/page' })
    expect((await get('/es/jsonapi')).body.links!.self).toEqual({ href: 'https://drupal.test/es/jsonapi' })
    expect(JSON.stringify(body)).not.toContain(ORIGIN)
  })
})

describe('an individual resource', () => {
  it('is served as Drupal wrote it, with its self link', async () => {
    const { status, body } = await get('/jsonapi/node/page/p-1')
    expect(status).toBe(200)
    const resource = body.data as Resource
    expect(resource.attributes!.title).toBe('About Umami')
    expect(resource.links!.self!.href).toBe('https://drupal.test/jsonapi/node/page/p-1?resourceVersion=id%3A1')
    expect(body.links!.self).toEqual({ href: 'https://drupal.test/jsonapi/node/page/p-1' })
  })

  it('applies sparse fieldsets, an empty one leaving no attributes', async () => {
    const titled = (await get('/jsonapi/node/page/p-1?fields[node--page]=title')).body.data as Resource
    expect(Object.keys(titled.attributes!)).toEqual(['title'])
    expect(titled.relationships).toBeUndefined()
    const bare = (await get('/jsonapi/node/page/p-1?fields[node--page]=')).body.data as Resource
    expect(bare.attributes).toBeUndefined()
    expect(Object.keys(bare)).toEqual(['type', 'id', 'links'])
  })

  it('includes along a path, each resource once, with fieldsets applied to the included type', async () => {
    const { body } = await get('/jsonapi/node/recipe/r-1?include=field_media_image,field_media_image.field_media_image,uid&fields[file--file]=filename')
    expect(body.included!.map((resource) => `${resource.type}:${resource.id}`)).toEqual(['media--image:m-1', 'file--file:f-1', 'user--user:u-1'])
    expect(body.included![1]!.attributes).toEqual({ filename: 'quiche.jpg' })
  })

  it('serves a related resource and a related collection', async () => {
    expect(((await get('/jsonapi/node/recipe/r-1/uid')).body.data as Resource).id).toBe('u-1')
    expect(ids((await get('/jsonapi/node/recipe/r-1/field_tags')).body)).toEqual(['t-1', 't-2'])
    expect((await get('/jsonapi/node/recipe/r-2/field_media_image')).body.data).toBeNull()
  })

  it('falls back to the default translation under a prefix without one', async () => {
    expect(((await get('/es/jsonapi/node/recipe/r-1')).body.data as Resource).attributes!.title).toBe('Quiche mediterráneo profundo')
    expect(((await get('/es/jsonapi/node/recipe/r-2')).body.data as Resource).attributes!.langcode).toBe('en')
  })

  it('is a JSON:API 404 for an unknown uuid or type, and an HTML 404 outside JSON:API', async () => {
    const missing = await get('/jsonapi/node/page/nope')
    expect(missing.status).toBe(404)
    expect(missing.body.errors![0]!.status).toBe('404')
    expect(missing.body.errors![0]!.links!.via!.href).toBe('https://drupal.test/jsonapi/node/page/nope')
    expect((await get('/jsonapi/menu_items/nope')).body.errors![0]!.detail).toContain('"menu" parameter')
    const unknownType = await get('/jsonapi/missing/test')
    expect(unknownType.status).toBe(404)
    expect(unknownType.headers.get('content-type')).toContain('text/html')
    const html = await get('/nope')
    expect(html.status).toBe(404)
    expect(html.headers.get('content-type')).toContain('text/html')
  })
})

describe('a collection', () => {
  it('filters in the shorthand form, on a nested property, and across a relationship', async () => {
    expect(ids((await get('/jsonapi/node/page?filter[status]=1')).body)).toEqual(['p-1'])
    expect(ids((await get('/jsonapi/block/block?filter[settings.provider]=block_content')).body)).toEqual(['b-2'])
    expect(ids((await get('/jsonapi/node/recipe?filter[uid.name]=umami&filter[field_difficulty]=easy')).body)).toEqual(['r-3'])
    expect(ids((await get('/jsonapi/node/recipe?filter[field_tags.id]=t-2')).body)).toEqual(['r-1'])
  })

  it('filters in the condition form with every operator Drupal takes, and in groups', async () => {
    const q = (filter: string) => get(`/jsonapi/node/recipe?${filter}`).then((r) => ids(r.body))
    expect(await q('filter[t][condition][path]=field_cooking_time&filter[t][condition][operator]=>&filter[t][condition][value]=40')).toEqual(['r-2', 'r-3'])
    expect(await q('filter[t][condition][path]=title&filter[t][condition][operator]=STARTS_WITH&filter[t][condition][value]=deep')).toEqual(['r-1'])
    expect(await q('filter[t][condition][path]=field_difficulty&filter[t][condition][operator]=IN&filter[t][condition][value][]=easy&filter[t][condition][value][]=hard')).toEqual(['r-2', 'r-3'])
    expect(await q('filter[t][condition][path]=field_cooking_time&filter[t][condition][operator]=BETWEEN&filter[t][condition][value][0]=40&filter[t][condition][value][1]=50')).toEqual(['r-3'])
    expect(await q('filter[t][condition][path]=field_media_image&filter[t][condition][operator]=IS NULL')).toEqual(['r-2', 'r-3'])
    expect(await q('filter[t][condition][path]=field_media_image&filter[t][condition][operator]=IS NOT NULL')).toEqual(['r-1'])
    expect(await q('filter[or][group][conjunction]=OR&filter[a][condition][path]=field_difficulty&filter[a][condition][value]=easy&filter[a][condition][memberOf]=or&filter[b][condition][path]=field_difficulty&filter[b][condition][value]=hard&filter[b][condition][memberOf]=or')).toEqual(['r-2', 'r-3'])
    expect(await q('filter[t][value]=Borscht&filter[t][path]=title&filter[t][operator]=<>')).toEqual(['r-1', 'r-3'])
  })

  it('refuses a bad operator with a 400 naming the parameter', async () => {
    const { status, body } = await get('/jsonapi/node/recipe?filter[t][condition][path]=title&filter[t][condition][operator]=LIKE&filter[t][condition][value]=x')
    expect(status).toBe(400)
    expect(body.errors![0]!.source).toEqual({ parameter: 'filter' })
  })

  it('sorts, ascending and descending, by several keys', async () => {
    expect(ids((await get('/jsonapi/node/recipe?sort=-field_cooking_time')).body)).toEqual(['r-2', 'r-3', 'r-1'])
    expect(ids((await get('/jsonapi/taxonomy_term/tags?sort=weight')).body)).toEqual(['t-2', 't-1'])
    expect(ids((await get('/jsonapi/node/recipe?sort=field_difficulty,-title')).body)).toEqual(['r-3', 'r-2', 'r-1'])
  })

  it('pages with offset and limit, writing next and prev as Drupal does', async () => {
    const first = (await get('/jsonapi/node/recipe?page[limit]=2&fields[node--recipe]=title')).body
    expect(ids(first)).toEqual(['r-1', 'r-2'])
    expect(first.links!.next!.href).toBe('https://drupal.test/jsonapi/node/recipe?page%5Boffset%5D=2&page%5Blimit%5D=2&fields%5Bnode--recipe%5D=title')
    expect((await get('/jsonapi/node/recipe?fields[node--recipe]=title&page[limit]=2')).body.links!.next!.href).toBe('https://drupal.test/jsonapi/node/recipe?fields%5Bnode--recipe%5D=title&page%5Boffset%5D=2&page%5Blimit%5D=2')
    expect(first.links!.prev).toBeUndefined()
    const second = (await get('/jsonapi/node/recipe?page[limit]=2&page[offset]=2')).body
    expect(ids(second)).toEqual(['r-3'])
    expect(second.links!.next).toBeUndefined()
    expect(second.links!.prev!.href).toContain('page%5Boffset%5D=0')
  })

  it('writes the self link with its parameters sorted by name and their inner order kept, as Drupal does', async () => {
    const { body } = await get('/jsonapi/node/page?page[limit]=1&fields[node--page]=')
    expect(body.links!.self!.href).toBe('https://drupal.test/jsonapi/node/page?fields%5Bnode--page%5D=&page%5Blimit%5D=1')
    expect((await get('/jsonapi/node/page?filter[status]=1&filter[langcode]=en&fields[node--page]=title')).body.links!.self!.href).toBe('https://drupal.test/jsonapi/node/page?fields%5Bnode--page%5D=title&filter%5Bstatus%5D=1&filter%5Blangcode%5D=en')
  })

  it('includes from every resource of the page', async () => {
    const { body } = await get('/jsonapi/node/recipe?include=field_tags')
    expect(body.included!.map((resource) => resource.id)).toEqual(['t-1', 't-2'])
  })

  it('refuses a method the route forbids', async () => {
    const response = await drupal.fetch('https://drupal.test/jsonapi/node/page', { method: 'POST', body: '{}' })
    expect(response.status).toBe(405)
  })
})

describe('the query parser', () => {
  it('nests brackets, appends an empty bracket or a repeated key, and keeps indexed values', () => {
    expect(parseQuery('filter[a][condition][value][]=x&filter[a][condition][value][]=y&sort=a&sort=b&page[limit]=5&v[0]=p&v[1]=q')).toEqual({
      filter: { a: { condition: { value: ['x', 'y'] } } },
      sort: ['a', 'b'],
      page: { limit: '5' },
      v: { 0: 'p', 1: 'q' },
    })
  })
})

describe('recorded routes', () => {
  it('answers Decoupled Router and JSON:API Menu Items from the recordings, relinked', async () => {
    const route = await get('/router/translate-path?path=%2Fabout-umami')
    expect(route.status).toBe(200)
    expect((route.body as unknown as { resolved: string }).resolved).toBe('https://drupal.test/about-umami')
    // JSON:API Menu Items applies its own filters to the recording; a query with another is no recording's.
    expect(ids((await get('/jsonapi/menu_items/main')).body)).toEqual(['ml-1', 'ml-2', 'ml-3', 'ml-4'])
    expect(ids((await get('/jsonapi/menu_items/main?filter[enabled]=1&filter[menu_name]=main')).body)).toEqual(['ml-1', 'ml-2', 'ml-3'])
    expect(ids((await get('/jsonapi/menu_items/main?filter[max_depth]=1')).body)).toEqual(['ml-1', 'ml-2', 'ml-4'])
    expect(ids((await get('/jsonapi/menu_items/main?filter[parent]=ml-2')).body)).toEqual(['ml-3'])
    expect(Object.keys(((await get('/jsonapi/menu_items/main?fields[menu_link_content--menu_link_content]=title')).body.data as Resource[])[0]!.attributes!)).toEqual(['title'])
    expect((await get('/jsonapi/menu_items/main?filter[nope]=1')).status).toBe(404)
    expect((await get('/router/translate-path?path=%2Fnope')).status).toBe(404)
  })
})

describe('what the anonymous user may reach', () => {
  const get = async (drupal: ReturnType<typeof createDrupal>, path: string) => {
    const response = await drupal.fetch(`https://drupal.test${path}`)
    return { status: response.status, body: await response.json() as { data: Array<{ id: string }>, errors?: Array<{ detail: string }>, meta?: { omitted?: unknown } } }
  }
  const withAccess = (access: NonNullable<typeof dump.access>[string]) => createDrupal({ ...dump, access: { en: access } }, { baseUrl: 'https://drupal.test' })

  it('refuses a filter through a relationship on a field of the type it reaches', async () => {
    const { status, body } = await get(withAccess({ 'user--user': { hidden: ['name'] } }), '/jsonapi/node/recipe?filter[uid.name]=umami')
    expect(status).toBe(403)
    expect(body.errors![0]!.detail).toBe('The current user is not authorized to filter by the `name` field, given in the path `uid.entity:user.name`.')
  })

  it('takes a filter through a relationship on a field it may read', async () => {
    expect((await get(withAccess({ 'user--user': { hidden: ['name'] } }), '/jsonapi/node/recipe?filter[uid.display_name]=Umami')).status).toBe(200)
  })

  it('still refuses a field of the collection\'s own type, naming the path as given', async () => {
    const { status, body } = await get(withAccess({ 'node--recipe': { hidden: ['field_difficulty'] } }), '/jsonapi/node/recipe?filter[field_difficulty]=easy')
    expect(status).toBe(403)
    expect(body.errors![0]!.detail).toContain('given in the path `field_difficulty`')
  })

  it('lists only the resources `visible` names, and refuses the rest by id', async () => {
    const drupal = withAccess({ 'node--recipe': { visible: ['r-1'] } })
    expect((await get(drupal, '/jsonapi/node/recipe')).body.data.map((resource) => resource.id)).toEqual(['r-1'])
    expect((await get(drupal, '/jsonapi/node/recipe/r-2')).status).toBe(403)
    expect((await get(drupal, '/jsonapi/node/recipe/r-1')).status).toBe(200)
  })

  it('reports a phantom as omitted: it takes a place in the collection and has no data', async () => {
    const drupal = withAccess({ 'node--recipe': { phantom: ['r-2'] } })
    const { body } = await get(drupal, '/jsonapi/node/recipe')
    expect(body.data.map((resource) => resource.id)).toEqual(['r-1', 'r-3'])
    expect(body.meta?.omitted).toBeDefined()
    expect((await get(drupal, '/jsonapi/node/recipe/r-2')).status).toBe(403)

  })
})

describe('a sort over translations', () => {
  const titles = ['Zebra', 'Yak', 'Aardvark']
  const translated = dump.resources.en!['node--recipe']!.map((recipe, index) => ({ ...recipe, attributes: { ...recipe.attributes, title: titles[index] } }))
  const multilingual = createDrupal({ ...dump, resources: { ...dump.resources, es: { ...dump.resources.en, 'node--recipe': translated } } }, { baseUrl: 'https://drupal.test' })
  const ids = async (path: string) => ((await (await multilingual.fetch(`https://drupal.test${path}`)).json()) as { data: Array<{ id: string }> }).data.map((recipe) => recipe.id)

  // English: Deep mediterranean quiche, Borscht, Fiery chili. Spanish: Zebra, Yak, Aardvark.
  it('ascending, reads the lowest value of any translation, in every language', async () => {
    expect(await ids('/jsonapi/node/recipe?sort=title')).toEqual(['r-3', 'r-2', 'r-1'])
    expect(await ids('/es/jsonapi/node/recipe?sort=title')).toEqual(['r-3', 'r-2', 'r-1'])
  })

  it('descending, reads the highest', async () => {
    expect(await ids('/jsonapi/node/recipe?sort=-title')).toEqual(['r-1', 'r-2', 'r-3'])
    expect(await ids('/es/jsonapi/node/recipe?sort=-title')).toEqual(['r-1', 'r-2', 'r-3'])
  })
})

describe('what the first review found', () => {
  const hidden = createDrupal({ ...dump, access: { en: { 'node--page': { hidden: ['field_secret'] }, 'file--file': { forbidden: true } } } }, { baseUrl: 'https://drupal.test' })
  const read = async (drupal: ReturnType<typeof createDrupal>, path: string) => { const response = await drupal.fetch(`https://drupal.test${path}`); const text = await response.text(); return { status: response.status, body: text.startsWith('<') ? { meta: { html: text } } : JSON.parse(text) as Document } }

  it('keeps a query from reaching the prototype', async () => {
    expect((await get('/jsonapi/node/page?__proto__[page][limit]=1')).status).toBe(200)
    expect(({} as { page?: unknown }).page).toBeUndefined()
    expect(ids((await get('/jsonapi/node/page')).body)).toEqual(['p-1', 'p-2'])
  })

  it('answers a HEAD with no body, applies init to a Request, and takes a base path with a trailing slash', async () => {
    const head = await drupal.fetch('https://drupal.test/jsonapi/node/page/p-1', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const viaRequest = await drupal.fetch(new Request('https://drupal.test/jsonapi/node/page/p-1'), { method: 'HEAD' })
    expect(await viaRequest.text()).toBe('')
    const slashed = createDrupal(dump, { baseUrl: 'https://drupal.test', basePath: '/jsonapi/' })
    expect((await read(slashed, '/jsonapi/node/page/p-1')).status).toBe(200)
  })

  it('lists an untranslated resource in its default language, and includes a resource once', async () => {
    expect(ids((await get('/es/jsonapi/node/recipe')).body)).toEqual(['r-1', 'r-2', 'r-3'])
    expect(((await get('/es/jsonapi/node/recipe')).body.data as Resource[])[0]!.attributes!.title).toBe('Quiche mediterráneo profundo')
    const { body } = await get('/jsonapi/node/recipe?include=field_related')
    expect(body.included).toBeUndefined()
  })

  it('walks no hidden relationship, omits a forbidden target, and refuses the hidden relationship\'s route', async () => {
    const included = await read(hidden, '/jsonapi/node/page/p-1?include=field_secret')
    expect(included.status).toBe(200)
    expect(included.body.included).toBeUndefined()
    const related = await read(hidden, '/jsonapi/node/page/p-1/field_secret')
    expect(related.status).toBe(403)
    expect(related.body.errors![0]!.detail).toBe('The current user is not allowed to view this relationship.')
    const media = await read(hidden, '/jsonapi/media/image/m-1?include=field_media_image')
    expect(media.body.included).toBeUndefined()
    expect(Object.keys((media.body.meta as { omitted: { links: object } }).omitted.links).some((key) => key.startsWith('item--'))).toBe(true)
  })

  it('refuses extra path segments, a filter on a field the type lacks, and a group named @root', async () => {
    expect((await get('/jsonapi/node/recipe/r-1/uid/extra')).status).toBe(404)
    const unknown = await get('/jsonapi/node/page?filter[nope]=1')
    expect(unknown.status).toBe(400)
    expect(unknown.body.errors![0]!.detail).toBe('Invalid nested filtering. The field `nope`, given in the path `nope`, does not exist.')
    expect((await get('/jsonapi/node/page?filter[@root][group][conjunction]=OR')).status).toBe(400)
  })

  it('compares a string field as text, and negates only a present value', async () => {
    expect(ids((await get('/jsonapi/node/page?filter[field_code]=1')).body)).toEqual([])
    expect(ids((await get('/jsonapi/node/page?filter[field_code]=01')).body)).toEqual(['p-1'])
    expect(ids((await get('/jsonapi/node/recipe?filter[field_cooking_time]=30')).body)).toEqual(['r-1'])
    expect(ids((await get('/jsonapi/node/page?filter[b][condition][path]=body.value&filter[b][condition][operator]=%3C%3E&filter[b][condition][value]=nope')).body)).toEqual(['p-1'])
  })

  it('refuses a filter on a field the visitor may not read, as Drupal\'s filter access does', async () => {
    const guarded = createDrupal({ ...dump, access: { en: { 'node--page': { hidden: ['field_code'] } } } }, { baseUrl: 'https://drupal.test' })
    const refused = await read(guarded, '/jsonapi/node/page?filter[field_code]=01')
    expect(refused.status).toBe(403)
    expect(refused.body.errors![0]!.detail).toBe('The current user is not authorized to filter by the `field_code` field, given in the path `field_code`.')
    expect((refused.body.errors![0]!.links as { via: { href: string } }).via.href).toBe('https://drupal.test/jsonapi/node/page?filter%5Bfield_code%5D=01')
  })
})

describe('what the second review found', () => {
  it('answers a HEAD on a recorded route as its GET, with no body', async () => {
    const route = await drupal.fetch('https://drupal.test/router/translate-path?path=%2Fabout-umami', { method: 'HEAD' })
    expect(route.status).toBe(200)
    expect(await route.text()).toBe('')
    expect((await drupal.fetch('https://drupal.test/jsonapi/menu_items/main', { method: 'HEAD' })).status).toBe(200)
  })

  it('reads no inherited member as a relationship or a field', async () => {
    for (const name of ['__proto__', 'constructor', 'toString']) {
      expect((await get(`/jsonapi/node/page/p-1/${name}`)).status, name).toBe(404)
      expect((await get(`/jsonapi/node/page/p-1?include=${name}`)).status, name).toBe(200)
    }
    // `constructor` never reaches the filter, as the parser drops it; an inherited name it keeps is refused.
    expect((await get('/jsonapi/node/page?filter[toString]=1')).status).toBe(400)
  })

  it('drops a key deeper than any Drupal reads instead of recursing out of the stack', () => {
    expect(parseQuery(`a${'['.repeat(50000)}=1`)).toEqual({})
    expect(parseQuery('filter[x][condition][value][]=1')).toEqual({ filter: { x: { condition: { value: ['1'] } } } })
  })
})
