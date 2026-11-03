/**
 * Points git at the committed hooks directory, since `core.hooksPath` is a per-clone setting. Only in this
 * repository's own checkout: an install inside another repository, as a published tarball unpacked in someone's
 * project is, must not rewrite that repository's hooks.
 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'

let top
try {
  top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
} catch {
  // Not a git checkout: nothing will commit.
}
if (top && realpathSync(top) === realpathSync(process.cwd())) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
  } catch (error) {
    console.warn(`The commit hooks are not on: ${error.message.split('\n')[0]}. Run: git config core.hooksPath .githooks`)
  }
}
