// Puts the rebuild summary on a pull request as one comment, which each run updates rather than adds to.
//
// Usage: node scripts/rebuild-comment.mjs <summary file>
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name) and PR (the pull request's number).
import { readFileSync } from 'node:fs'

/** Marks the comment this script owns, so a later run finds it among the others. */
export const MARKER = '<!-- decoupled-drupal-mock:rebuild-summary -->'

/**
 * Creates, updates or leaves the pull request's rebuild comment.
 *
 * @param options - What to post, and where.
 * @param options.summary - The summary `yarn rebuild:summary --out` wrote.
 * @param options.rebuilt - Whether any preset's recordings changed.
 * @param options.repository - The repository, as `owner/name`.
 * @param options.pr - The pull request's number.
 * @param options.token - A token that may write comments on it.
 * @param [options.request] - How to call GitHub's API.
 * @returns What it did.
 */
export const postRebuildComment = async ({ summary, rebuilt, repository, pr, token, request = fetch }) => {
  const api = `https://api.github.com/repos/${repository}/issues`
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' }
  const call = async (url, init = {}) => {
    const response = await request(url, { ...init, headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}) } })
    if (!response.ok) throw new Error(`${init.method || 'GET'} ${url} answered ${response.status}.`)
    return response.json()
  }
  let existing
  for (let page = 1; !existing; page++) {
    const comments = await call(`${api}/${pr}/comments?per_page=100&page=${page}`)
    existing = comments.find((comment) => typeof comment.body === 'string' && comment.body.startsWith(MARKER))
    if (comments.length < 100) break
  }
  // A pull request that never changed a recording gets no comment. One that stopped changing them says so.
  if (!existing && !rebuilt) return 'none'
  const body = `${MARKER}\n# What the rebuild changed\n\n${summary}`
  if (existing?.body === body) return 'unchanged'
  if (existing) {
    await call(`${api}/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
    return 'updated'
  }
  await call(`${api}/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
  return 'created'
}

if (process.argv[1]?.endsWith('rebuild-comment.mjs')) {
  const summary = readFileSync(process.argv[2], 'utf8')
  const { NO_REBUILD } = await import('../packages/build/src/rebuild-summary.ts')
  const done = await postRebuildComment({ summary, rebuilt: summary !== NO_REBUILD, repository: process.env.GITHUB_REPOSITORY, pr: process.env.PR, token: process.env.GITHUB_TOKEN })
  console.log(`rebuild comment: ${done}`)
}
