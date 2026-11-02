import { createDrupal } from './engine.js'
import type { DrupalOptions } from './engine.js'
import { createClock, extend, withFixtures } from './extend.js'
import type { ExtendedDrupal, Extension } from './extend.js'
import type { Dump } from './types.js'

/**
 * The engine with extensions, a request log and a clock a test can move.
 *
 * @param dump - The preset's dump.
 * @param options - The engine's options, and the extensions.
 * @returns The mock.
 */
export const createMock = (dump: Dump, options: DrupalOptions & { extensions?: Extension[] } = {}): ExtendedDrupal => {
  const { extensions = [], ...rest } = options
  const clock = createClock()
  return extend(createDrupal(withFixtures(dump, extensions), { ...rest, now: clock.now }), extensions, clock)
}
