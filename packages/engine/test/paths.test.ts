import { describe, expect, it } from 'vitest'
import { createDrupal } from '../src'
import { createReader } from '../src/filter'
import type { Document, Resource, TypeFilters } from '../src'
import { dump } from './dump'

// What a build's probes record, with Drupal's own messages: the real site these were read from answered each one.
const filters: Record<string, TypeFilters> = {
  'node--page': {
    refused: ['field_secret'],
    specifiers: { uid: ['id', 'meta.drupal_internal__target_id', 'meta.target_uuid'], path: ['alias', 'pid', 'langcode'], body: ['value', 'format', 'processed', 'summary'], field_secret: ['id', 'meta.drupal_internal__target_id'] },
    failures: { 'path.alias': '\'path\' not found', 'uid.meta.target_uuid': 'Invalid specifier \'target_uuid\'' },
  },
  'node--recipe': { specifiers: { uid: ['id', 'meta.drupal_internal__target_id', 'meta.target_uuid'] } },
  'user--user': { refused: ['mail', 'timezone', 'roles'], specifiers: { roles: ['id', 'meta.drupal_internal__target_id'] } },
  'media--image': { specifiers: { field_media_image: ['id', 'meta.drupal_internal__target_id', 'meta.alt'] } },
  'file--file': {},
  'block--block': { config: true, failures: { settings: 'mb_strtolower(): Argument #1 ($string) must be of type string, array given' } },
}
const drupal = createDrupal({ ...dump, filters }, { baseUrl: 'https://drupal.test' })
const admin = { authorization: `Bearer ${drupal.tokenFor('admin').access}` }
const ask = async (path: string, headers: Record<string, string> = {}): Promise<{ status: number, detail?: string | undefined, titles?: unknown[] }> => {
  const response = await drupal.fetch(`https://drupal.test/jsonapi/${path}`, { headers })
  const body = await response.json() as Document
  return body.errors ? { status: response.status, detail: body.errors[0]!.detail } : { status: response.status, titles: (body.data as Resource[]).map((resource) => resource.attributes?.title ?? resource.id) }
}
const nested = (detail: string) => ({ status: 400, detail: `Invalid nested filtering. ${detail}` })
const elided = (property: string, path: string, kept: string, given: string) => nested(`The property \`${property}\`, given in the path \`${path}\`, does not exist. Filter by \`${kept}\`, not \`${given}\` (the JSON:API module elides property names from single-property fields).`)
const refused = (field: string, path: string) => ({ status: 403, detail: `The current user is not authorized to filter by the \`${field}\` field, given in the path \`${path}\`.` })

describe('a filter path, as JSON:API\'s field resolver walks it', () => {
  it('lets a visitor filter by a field it cannot read, and refuses only the fields Drupal refused', async () => {
    expect(await ask('node/page?filter[uid.name]=admin')).toMatchObject({ status: 200 })
    expect(await ask('node/page?filter[uid.drupal_internal__uid]=1')).toMatchObject({ status: 200 })
    expect(await ask('node/page?filter[uid.mail]=x')).toEqual(refused('mail', 'uid.entity:user.mail'))
    expect(await ask('node/page?filter[uid.entity.mail]=x')).toEqual(refused('mail', 'uid.entity:user.mail'))
    expect(await ask('node/page?filter[uid.roles.id]=x')).toEqual(refused('roles', 'uid.entity:user.roles'))
    // Access comes first: a property below a refused field is refused, not missing.
    expect(await ask('user/user?filter[mail.x]=x')).toEqual(refused('mail', 'mail'))
    expect((await ask('user/user?filter[mail]=x', admin)).status).toBe(200)
  })

  it('reads through `entity` and `entity:type`, resolving the field on the types the relationship reaches', async () => {
    const name = String(dump.resources.en!['user--user']!.find((user) => user.id === 'u-1')!.attributes!.name)
    for (const path of ['uid.name', 'uid.entity.name', 'uid.entity:user.name']) {
      expect((await ask(`node/page?filter[${path}]=${encodeURIComponent(name)}`, admin)).titles!.length).toBeGreaterThan(0)
    }
    expect(await ask('node/page?filter[uid.entity]=x')).toMatchObject({ status: 200, titles: [] })
    expect(await ask('node/page?filter[uid.entity:node.title]=x')).toEqual(nested('The field `title`, given in the path `uid.entity:node.title`, does not exist.'))
    expect(await ask(`node/page?filter[uid.entity:node.name]=${encodeURIComponent(name)}`, admin)).toMatchObject({ status: 200, titles: [] })
  })

  it('refuses a path that ends at a field it must go past, naming what it must end with', async () => {
    expect(await ask('node/page?filter[uid]=x')).toEqual(nested('The field `uid`, given in the path `uid` is incomplete, it must end with one of the following specifiers: `id`, `meta.drupal_internal__target_id`, `meta.target_uuid`.'))
    expect(await ask('node/page?filter[path]=x')).toEqual(nested('The field `path`, given in the path `path` is incomplete, it must end with one of the following specifiers: `alias`, `pid`, `langcode`.'))
    expect(await ask('node/page?filter[uid.roles]=x', admin)).toEqual(nested('The field `roles`, given in the path `uid.roles` is incomplete, it must end with one of the following specifiers: `id`, `meta.drupal_internal__target_id`.'))
  })

  it('refuses a field the type reached does not have, naming the whole path', async () => {
    for (const path of ['uid.nope', 'uid.uuid', 'uid.entity.uuid', 'nope.x']) {
      const field = path.split('.').find((part) => part === 'nope' || part === 'uuid')!
      expect(await ask(`node/page?filter[${path}]=x`)).toEqual(nested(`The field \`${field}\`, given in the path \`${path}\`, does not exist.`))
    }
  })

  it('refuses a property below a single-property field, and below a relationship\'s id', async () => {
    expect(await ask('node/page?filter[title.value]=x')).toEqual(elided('value', 'title.value', 'title', 'title.value'))
    expect(await ask('node/page?filter[id.x]=x')).toEqual(elided('x', 'id.x', 'id', 'id.x'))
    expect(await ask('node/page?filter[uid.id.x]=x')).toEqual(elided('x', 'uid.id.x', 'uid.id', 'uid.id.x'))
    expect(await ask('node/page?filter[uid.name.value]=x')).toEqual(elided('value', 'uid.name.value', 'uid.name', 'uid.name.value'))
  })

  it('takes a property of a field with several, and answers what Drupal answered for one it fails on', async () => {
    expect(await ask('node/page?filter[body.value]=x')).toMatchObject({ status: 200 })
    expect(await ask('node/page?filter[path.nope]=x')).toEqual(nested('The property `nope`, given in the path `path.nope`, does not exist. Must be one of the following property names: `alias`, `pid`, `langcode`.'))
    expect(await ask('node/page?filter[path.alias]=x')).toEqual({ status: 500, detail: '\'path\' not found' })
    expect(await ask('node/page?filter[body.value.x]=x')).toEqual({ status: 500, detail: 'Invalid specifier \'x\'' })
  })

  it('takes a relationship\'s meta only by the properties Drupal names', async () => {
    expect(await ask('node/page?filter[uid.meta]=x')).toMatchObject({ status: 200 })
    expect(await ask('node/page?filter[uid.meta.drupal_internal__target_id]=1')).toMatchObject({ status: 200 })
    expect(await ask('media/image?filter[field_media_image.meta.alt]=A%20quiche')).toMatchObject({ status: 200, titles: [expect.any(String)] })
    expect(await ask('node/page?filter[uid.meta.nope]=x')).toEqual(nested('The field `nope`, given in the path `uid.meta.nope`, does not exist.'))
    expect(await ask('node/page?filter[uid.meta.target_uuid]=x')).toEqual({ status: 500, detail: 'Invalid specifier \'target_uuid\'' })
    expect(await ask('node/page?filter[uid.meta.drupal_internal__target_id.x]=x')).toEqual({ status: 500, detail: 'Invalid specifier \'x\'' })
  })

  it('checks a sort\'s paths as a filter\'s, after the filter\'s', async () => {
    expect(await ask('node/page?sort=uid')).toEqual(nested('The field `uid`, given in the path `uid` is incomplete, it must end with one of the following specifiers: `id`, `meta.drupal_internal__target_id`, `meta.target_uuid`.'))
    expect(await ask('node/page?sort=-uid.mail')).toEqual(refused('mail', 'uid.entity:user.mail'))
    expect(await ask('node/page?sort=uid.nope')).toEqual(nested('The field `nope`, given in the path `uid.nope`, does not exist.'))
    expect((await ask('node/page?sort=-uid.name')).status).toBe(200)
    expect(await ask('node/page?filter[uid.mail]=x&sort=nope')).toEqual(refused('mail', 'uid.entity:user.mail'))
    expect(await ask('node/page?sort=zzz,uid.mail')).toEqual(nested('The field `zzz`, given in the path `zzz`, does not exist.'))
  })

  it('checks the filter\'s paths in the order the query names them', async () => {
    expect(await ask('node/page?filter[aaa]=y&filter[uid.mail]=x')).toEqual(nested('The field `aaa`, given in the path `aaa`, does not exist.'))
    expect(await ask('node/page?filter[uid.mail]=x&filter[aaa]=y')).toEqual(refused('mail', 'uid.entity:user.mail'))
    const named = (first: string, second: string) => `filter[b][condition][path]=${first}&filter[b][condition][value]=x&filter[a][condition][path]=${second}&filter[a][condition][value]=y`
    expect(await ask(`node/page?${named('zzz', 'uid.mail')}`)).toEqual(nested('The field `zzz`, given in the path `zzz`, does not exist.'))
    expect(await ask(`node/page?${named('uid.mail', 'zzz')}`)).toEqual(refused('mail', 'uid.entity:user.mail'))
  })

  it('checks only the first field of a configuration entity\'s path', async () => {
    expect(await ask('block/block?filter[settings.label]=x')).toMatchObject({ status: 200 })
    expect(await ask('block/block?filter[id.x]=x')).toMatchObject({ status: 200 })
    expect(await ask('block/block?filter[settings]=x')).toEqual({ status: 500, detail: 'mb_strtolower(): Argument #1 ($string) must be of type string, array given' })
    expect(await ask('block/block?filter[nope.x]=x')).toEqual(nested('The field `nope`, given in the path `nope.x`, does not exist.'))
  })
})

describe('reading a filter path through a relationship', () => {
  const term = (id: string, parent: string): Resource => ({ type: 'taxonomy_term--tags', id, attributes: { name: id }, relationships: { parent: { data: [{ type: 'taxonomy_term--tags', id: parent }] } } })
  const resources = [term('root', 'virtual'), term('child', 'root'), term('orphan', 'missing')]
  const read = createReader((identifier) => resources.find((resource) => resource.id === identifier.id))

  it('reads no uuid for a reference to no entity, as no uuid Drupal stores matches one', () => {
    expect(read(resources[0]!, ['parent', 'id'])).toEqual([])
    expect(read(resources[2]!, ['parent'])).toEqual([])
    expect(read(resources[1]!, ['parent', 'id'])).toEqual(['root'])
  })

  it('reads the referenced entity through `entity`, and through `entity:type` only for that type', () => {
    expect(read(resources[1]!, ['parent', 'entity', 'name'])).toEqual(['root'])
    expect(read(resources[1]!, ['parent', 'entity:taxonomy_term', 'name'])).toEqual(['root'])
    expect(read(resources[1]!, ['parent', 'entity:user', 'name'])).toEqual([])
  })
})
