import { describe, expect, it } from 'vitest'
import { MARKER, postRebuildComment } from './rebuild-comment.mjs'

/** A GitHub that holds one pull request's comments, and the calls made to it. */
const bot = { login: 'github-actions[bot]' }
const github = (comments) => {
  const calls = []
  const request = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url.replace('https://api.github.com/repos/o/r/issues', '')}`)
    if (!init.method) {
      const page = Number(new URL(url).searchParams.get('page'))
      return { ok: true, json: async () => comments.slice((page - 1) * 100, page * 100) }
    }
    return { ok: true, json: async () => JSON.parse(init.body) }
  }
  return { calls, request }
}
const post = (summary, rebuilt, request) => postRebuildComment({ summary, rebuilt, repository: 'o/r', pr: 7, token: 't', request })
const body = (summary) => `${MARKER}\n# What the rebuild changed\n\n${summary}`

describe('the rebuild comment on a pull request', () => {
  it('posts the summary once, and updates that comment after', async () => {
    const fresh = github([{ id: 1, user: { login: 'someone' }, body: 'A review' }])
    expect(await post('## The p rebuild\n', true, fresh.request)).toBe('created')
    expect(fresh.calls).toEqual(['GET /7/comments?per_page=100&page=1', 'POST /7/comments'])
    const later = github([{ id: 1, user: { login: 'someone' }, body: 'A review' }, { id: 2, user: bot, body: body('## The p rebuild\n') }])
    expect(await post('## The p rebuild\n\nMore.\n', true, later.request)).toBe('updated')
    expect(later.calls.at(-1)).toBe('PATCH /comments/2')
    expect(await post('## The p rebuild\n', true, later.request)).toBe('unchanged')
  })

  it('finds its comment past the first page of a long thread', async () => {
    const long = github([...Array.from({ length: 100 }, (_, id) => ({ id, user: { login: 'someone' }, body: 'chat' })), { id: 100, user: bot, body: body('old') }])
    expect(await post('new', true, long.request)).toBe('updated')
    expect(long.calls).toEqual(['GET /7/comments?per_page=100&page=1', 'GET /7/comments?per_page=100&page=2', 'PATCH /comments/100'])
  })

  it('posts nothing on a pull request that changes no recordings, and corrects one that stopped', async () => {
    const quiet = github([])
    expect(await post('No change.\n', false, quiet.request)).toBe('none')
    expect(quiet.calls).toEqual(['GET /7/comments?per_page=100&page=1'])
    const reverted = github([{ id: 3, user: bot, body: body('## The p rebuild\n') }])
    expect(await post('No change.\n', false, reverted.request)).toBe('updated')
  })

  it('updates only the comment it posted, not a marked comment someone else wrote', async () => {
    const copied = github([{ id: 4, user: { login: 'someone' }, body: body('pasted') }, { id: 5, user: bot, body: body('old') }])
    expect(await post('new', true, copied.request)).toBe('updated')
    expect(copied.calls.at(-1)).toBe('PATCH /comments/5')
    const only = github([{ id: 6, user: { login: 'someone' }, body: body('pasted') }])
    expect(await post('new', true, only.request)).toBe('created')
    expect(only.calls.at(-1)).toBe('POST /7/comments')
  })

  it('stops when GitHub refuses a call, naming it', async () => {
    const refused = async () => ({ ok: false, status: 403, json: async () => ({}) })
    await expect(post('x', true, refused)).rejects.toThrow('GET https://api.github.com/repos/o/r/issues/7/comments?per_page=100&page=1 answered 403.')
  })
})
