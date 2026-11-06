import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { createDrupal } from '../src'
import { answerAxios, axiosAdapter, axiosVerbs } from '../src/axios'
import { clone } from '../src/clone'
import { connectMock } from '../src/control'
import { presetDir } from '../src/preset'
import { spawnMock } from '../src/runner'
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

  it('writes nested params and a form body as axios does', async () => {
    const spy = { ...drupal, handle: vi.fn(() => ({ status: 200, headers: {}, body: {} })) }
    const sent = (index: number) => (spy.handle.mock.lastCall as unknown as unknown[])[index]
    await answerAxios(spy, { baseURL: baseUrl, url: '/a', params: { filter: { status: 1, skip: null }, id: [1, 2], at: new Date(0) } })
    expect(decodeURIComponent(sent(1) as string)).toBe(`${baseUrl}/a?filter[status]=1&id[]=1&id[]=2&at=1970-01-01T00:00:00.000Z`)
    await answerAxios(spy, { baseURL: baseUrl, url: '/oauth/token', method: 'post', data: { grant_type: 'password', scope: 'a b' }, headers: { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=utf-8' } })
    expect(sent(3)).toBe('grant_type=password&scope=a+b')
  })

  it('answers a HEAD with its GET status and no body', async () => {
    const response = await axiosVerbs(drupal, baseUrl).head('/jsonapi/node/page/p-1')
    expect(response.status).toBe(200)
    expect(response.data).toBe('')
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

  it('finds a preset package whose exports leave out its package.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'preset-'))
    mkdirSync(join(root, 'node_modules', 'decoupled-drupal-mock-closed'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'decoupled-drupal-mock-closed', 'package.json'), JSON.stringify({ name: 'decoupled-drupal-mock-closed', exports: { '.': './index.js' } }))
    // Not a preset until it holds a build.
    expect(() => presetDir('closed', root)).toThrow('closed is not an installed preset package')
    mkdirSync(join(root, 'node_modules', 'decoupled-drupal-mock-closed', 'dump'))
    writeFileSync(join(root, 'node_modules', 'decoupled-drupal-mock-closed', 'dump', 'manifest.json'), '{}')
    expect(presetDir('closed', root)).toBe(join(root, 'node_modules', 'decoupled-drupal-mock-closed', 'dump'))
  })

  it('finds a preset installed beside the engine, as npx installs the two, when the current directory has none', () => {
    const cache = mkdtempSync(join(tmpdir(), 'npx-'))
    const engine = join(cache, 'node_modules', 'decoupled-drupal-mock', 'dist')
    mkdirSync(engine, { recursive: true })
    mkdirSync(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'dump'), { recursive: true })
    writeFileSync(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'package.json'), JSON.stringify({ name: 'decoupled-drupal-mock-beside' }))
    writeFileSync(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'dump', 'manifest.json'), '{}')
    const elsewhere = mkdtempSync(join(tmpdir(), 'cwd-'))
    expect(presetDir('beside', elsewhere, engine)).toBe(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'dump'))
    // The current directory still wins, so a project's own copy is the one served.
    mkdirSync(join(elsewhere, 'node_modules', 'decoupled-drupal-mock-beside', 'dump'), { recursive: true })
    writeFileSync(join(elsewhere, 'node_modules', 'decoupled-drupal-mock-beside', 'package.json'), JSON.stringify({ name: 'decoupled-drupal-mock-beside' }))
    writeFileSync(join(elsewhere, 'node_modules', 'decoupled-drupal-mock-beside', 'dump', 'manifest.json'), '{}')
    expect(presetDir('beside', elsewhere, engine)).toBe(join(elsewhere, 'node_modules', 'decoupled-drupal-mock-beside', 'dump'))
  })

  it('looks past a package of the same name that holds no build', () => {
    const cache = mkdtempSync(join(tmpdir(), 'npx-'))
    const engine = join(cache, 'node_modules', 'decoupled-drupal-mock', 'dist')
    mkdirSync(engine, { recursive: true })
    mkdirSync(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'dump'), { recursive: true })
    writeFileSync(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'package.json'), JSON.stringify({ name: 'decoupled-drupal-mock-beside' }))
    writeFileSync(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'dump', 'manifest.json'), '{}')
    // A project can hold an unrelated package by the short name, as `umami` is on npm.
    const elsewhere = mkdtempSync(join(tmpdir(), 'cwd-'))
    mkdirSync(join(elsewhere, 'node_modules', 'beside'), { recursive: true })
    writeFileSync(join(elsewhere, 'node_modules', 'beside', 'package.json'), JSON.stringify({ name: 'beside' }))
    expect(presetDir('beside', elsewhere, engine)).toBe(join(cache, 'node_modules', 'decoupled-drupal-mock-beside', 'dump'))
  })

  it('still finds a preset when a CommonJS bundle leaves out the module URL', () => {
    // A consumer that bundles the engine to CommonJS with no shim gets an empty import.meta.
    const { outputFiles } = buildSync({ entryPoints: [fileURLToPath(new URL('../src/preset.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
    const bundled = { exports: {} as { presetDir: typeof presetDir } }
    new Function('module', 'exports', 'require', outputFiles[0]!.text)(bundled, bundled.exports, createRequire(import.meta.url))
    const dir = mkdtempSync(join(tmpdir(), 'dump-'))
    expect(bundled.exports.presetDir(dir)).toBe(dir)
    expect(() => bundled.exports.presetDir('no-such-preset')).toThrow('no-such-preset is not an installed preset package')
  })

  it('gives up on a port held by something that never answers', async () => {
    const silent = createServer(() => { /* Takes the connection and says nothing. */ })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const { port } = silent.address() as { port: number }
    try {
      await expect(spawnMock('umami', { port })).rejects.toThrow('The mock did not start')
    } finally {
      silent.close()
    }
  }, 15000)

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
