import { describe, expect, it, vi } from 'vitest'
import { createDrupal } from '../src'
import { answerAxios, axiosAdapter, axiosVerbs } from '../src/axios'
import { clone } from '../src/clone'
import { connectMock } from '../src/control'
import { presetDir } from '../src/preset'
import { dump } from './dump'

const baseUrl = 'https://drupal.test'
const drupal = createDrupal(dump, { baseUrl })

describe('axios', () => {
  it('answers a relative URL against the base, and an absolute one as it stands', async () => {
    const verbs = axiosVerbs(drupal, baseUrl)
    expect((await verbs.get('/jsonapi/node/page/p-1')).status).toBe(200)
    const absolute = await verbs.get(`${baseUrl}/jsonapi/node/page/p-1`)
    expect((absolute.data as { data: { id: string } }).data.id).toBe('p-1')
  })

  it('prefers the config baseURL and appends params', async () => {
    const response = await answerAxios(drupal, { baseURL: `${baseUrl}/`, url: 'jsonapi/node/page', params: { 'page[limit]': 1, skipped: undefined } })
    expect((response.data as { links: { self: { href: string } } }).links.self.href).toContain('page%5Blimit%5D=1')
  })

  it('rejects a status validateStatus turns down, with the response on the error', async () => {
    const error = await answerAxios(drupal, { baseURL: baseUrl, url: '/jsonapi/nope' }).catch((caught: unknown) => caught) as Error & { response: { status: number }, isAxiosError: boolean }
    expect(error.message).toBe('Request failed with status code 404')
    expect(error.response.status).toBe(404)
    expect(error.isAxiosError).toBe(true)
  })

  it('takes a status validateStatus accepts, and null as accepting all', async () => {
    expect((await answerAxios(drupal, { baseURL: baseUrl, url: '/jsonapi/nope', validateStatus: (status) => status === 404 })).status).toBe(404)
    expect((await answerAxios(drupal, { baseURL: baseUrl, url: '/jsonapi/nope', validateStatus: null })).status).toBe(404)
  })

  it('sends an object as JSON and a string as it stands, with the headers it was given', async () => {
    const spy = { ...drupal, handle: vi.fn(() => ({ status: 200, headers: {}, body: {} })) }
    await answerAxios(spy, { baseURL: baseUrl, url: '/a', method: 'post', data: { a: 1 }, headers: { Accept: 'x', Skip: undefined } })
    expect(spy.handle).toHaveBeenLastCalledWith('POST', `${baseUrl}/a`, { accept: 'x' }, '{"a":1}')
    await axiosAdapter(spy, baseUrl)({ url: '/a', method: 'post', data: 'text' })
    expect(spy.handle).toHaveBeenLastCalledWith('POST', `${baseUrl}/a`, {}, 'text')
  })
})

describe('what a test runner on an older platform needs', () => {
  it('copies without structuredClone', () => {
    const real = globalThis.structuredClone
    vi.stubGlobal('structuredClone', undefined)
    try {
      const value = { a: [1] }
      const copy = clone(value)
      expect(copy).toEqual(value)
      expect(copy.a).not.toBe(value.a)
    } finally {
      vi.stubGlobal('structuredClone', real)
    }
  })

  it('names what a preset that is not there was', () => {
    expect(() => presetDir('no/such/dir')).toThrow('no/such/dir is not a directory')
    expect(() => presetDir('no-such-preset')).toThrow('no-such-preset is not an installed preset package')
  })

  it('finds a preset package by its short name', () => {
    expect(presetDir('umami')).toMatch(/presets\/umami\/dump$|decoupled-drupal-mock-umami\/dump$/)
  })

  it('asks for a URL when there is none to connect to', () => {
    const before = process.env.DECOUPLED_DRUPAL_MOCK_URL
    delete process.env.DECOUPLED_DRUPAL_MOCK_URL
    expect(() => connectMock()).toThrow('No server to connect to')
    if (before) process.env.DECOUPLED_DRUPAL_MOCK_URL = before
  })
})
