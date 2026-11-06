import { describe, expect, it } from 'vitest'
import { fromEnvironment } from '../src/config'

describe('a build configuration read from the environment', () => {
  it('replaces each reference, however deep, and leaves the rest as it is', () => {
    const config = { baseUrl: '${SITE_URL}', drush: { bin: '${SITE}/vendor/bin/drush' }, paths: ['${SITE}/a', 'b'], port: 8906, on: true, none: null }
    expect(fromEnvironment(config, { SITE_URL: 'http://127.0.0.1:8906', SITE: '/srv/site' })).toEqual({ baseUrl: 'http://127.0.0.1:8906', drush: { bin: '/srv/site/vendor/bin/drush' }, paths: ['/srv/site/a', 'b'], port: 8906, on: true, none: null })
  })

  it('names every variable it needs and the environment does not set', () => {
    expect(() => fromEnvironment({ a: '${ONE}', b: ['${TWO}'], c: '${ONE}' }, { TWO: '' })).toThrow('reads ONE, TWO from the environment: set them.')
    expect(() => fromEnvironment({ secret: '${SECRET}' }, {})).toThrow('reads SECRET from the environment: set it.')
  })

  it('refuses a reference that is not a variable name in capitals, rather than keep it as text', () => {
    expect(() => fromEnvironment({ a: '${SITE-URL}', b: '${site_url}', c: '${OPEN' }, { SITE: 'x' })).toThrow('has ${OPEN, ${SITE-URL}, ${site_url}: a reference is ${NAME}')
    expect(() => fromEnvironment({ a: '${TOSTRING}' }, Object.create({ TOSTRING: 'inherited' }) as Record<string, string>)).toThrow('reads TOSTRING from the environment')
  })
})
