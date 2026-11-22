import { describe, expect, it } from 'vitest'
import { createDrupal, relinker } from '../src'
import { dump } from './dump'

// As Drupal Canvas writes an image's widths: the origin in a query value, its colons encoded and its slashes not.
const widths = (origin: string) => `${origin}/sites/default/files/a.jpg?alternateWidths=${origin.replace(/:/g, '%3A')}/sites/default/files/styles/w/a.jpg`

describe('an origin in a recorded document', () => {
  it('is replaced as written plainly, with its colons encoded, and encoded whole', () => {
    const relink = relinker('http://127.0.0.1:8934', 'https://drupal.invalid')
    expect(relink(widths('http://127.0.0.1:8934'))).toBe(widths('https://drupal.invalid'))
    expect(relink(`?next=${encodeURIComponent('http://127.0.0.1:8934/node/1')}`)).toBe(`?next=${encodeURIComponent('https://drupal.invalid/node/1')}`)
  })

  it('is matched whether or not either origin is given with a trailing slash', () => {
    for (const [from, to] of [['http://127.0.0.1:8934/', 'https://drupal.invalid'], ['http://127.0.0.1:8934', 'https://drupal.invalid/'], ['http://127.0.0.1:8934//', 'https://drupal.invalid//']]) {
      expect(relinker(from!, to!)(widths('http://127.0.0.1:8934'))).toBe(widths('https://drupal.invalid'))
    }
  })

  it('is not matched inside another host that begins with it, in any of those forms', () => {
    const relink = relinker('http://127.0.0.1:8934', 'https://drupal.invalid')
    for (const other of ['http://127.0.0.1:89341', 'http%3A//127.0.0.1%3A89341', encodeURIComponent('http://127.0.0.1:89341'), 'http://127.0.0.1:8934.example.com']) {
      expect(relink(`${other}/x`)).toBe(`${other}/x`)
    }
    // The same host on another port is another site too, its port's colon encoded or not.
    const served = relinker('https://drupal.invalid', 'http://localhost:4000')
    for (const other of ['https://drupal.invalid:8443', 'https%3A//drupal.invalid%3A8443', 'https%3a//drupal.invalid%3a8443', encodeURIComponent('https://drupal.invalid:8443')]) {
      expect(served(`${other}/x`)).toBe(`${other}/x`)
    }
    // A path after the origin, its slash encoded or not, is still the origin's.
    expect(served(encodeURIComponent('https://drupal.invalid/x'))).toBe(encodeURIComponent('http://localhost:4000/x'))
  })

  it('is served at the server\'s base URL, in the form it was recorded in', () => {
    const recorded = widths('https://drupal.invalid')
    const page = dump.resources.en!['node--page']![0]!
    const changed = { ...dump, resources: { ...dump.resources, en: { ...dump.resources.en, 'node--page': [{ ...page, attributes: { ...page.attributes, title: recorded } }, ...dump.resources.en!['node--page']!.slice(1)] } } }
    const drupal = createDrupal(changed, { baseUrl: 'http://localhost:4000' })
    const answer = drupal.handle('GET', `http://localhost:4000/jsonapi/node/page/${page.id}`)
    const title = (answer.body as { data: { attributes: { title: string } } }).data.attributes.title
    expect(title).toBe(widths('http://localhost:4000'))
    expect(title).not.toContain('drupal.invalid')
  })
})
