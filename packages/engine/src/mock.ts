import { createDrupal } from './engine.js'
import type { DrupalOptions } from './engine.js'
import { createClock, extend, withFixtures } from './extend.js'
import type { ExtendedDrupal, Extension } from './extend.js'
import type { Dump } from './types.js'

/**
 * The engine with extensions, a request log and a clock a test can move.
 *
 * @param dump - The preset's dump.
 * @param options - The engine's options, the extensions, and the engine to wrap: GraphQL's has the schema's endpoint too.
 * @returns The mock.
 */
export const createMock = (dump: Dump, options: DrupalOptions & { extensions?: Extension[], create?: typeof createDrupal } = {}): ExtendedDrupal => {
  const { extensions = [], create = createDrupal, ...rest } = options
  const clock = createClock()
  return extend(create(withFixtures(dump, extensions), { ...rest, now: clock.now }), extensions, clock, rest.basePath)
}
