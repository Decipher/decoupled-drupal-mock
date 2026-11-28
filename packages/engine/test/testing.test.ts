import { describe, expect, it } from 'vitest'
import { startMock } from '../src/testing'

describe('a server from startMock', () => {
  it('clears a delay on reset(), as it puts back the engine', async () => {
    const mock = await startMock('umami')
    try {
      const timed = async (): Promise<number> => {
        const started = performance.now()
        expect((await fetch(`${mock.url}/jsonapi`)).status).toBe(200)
        return performance.now() - started
      }
      await mock.delay(300, '/jsonapi')
      // A timer can fire a millisecond early, so the bound leaves a little room.
      expect(await timed()).toBeGreaterThanOrEqual(290)
      await mock.reset()
      expect(await timed()).toBeLessThan(290)
    } finally {
      await mock.close()
    }
  })

  it('answers the client\'s calls from its own engine, in this process', async () => {
    const mock = await startMock('umami')
    try {
      expect((await mock.tokenFor('editor')).access).toEqual(expect.any(String))
      await fetch(`${mock.url}/jsonapi`)
      expect((await mock.requests()).map((request) => request.path)).toContain('/jsonapi')
      expect(await mock.sent()).toEqual([])
      await mock.advanceTime(1)
      await expect(mock.scenario('none')).rejects.toThrow()
    } finally {
      await mock.close()
    }
  })
})
