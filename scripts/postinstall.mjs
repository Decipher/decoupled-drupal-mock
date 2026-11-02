/**
 * Points git at the committed hooks directory, since `core.hooksPath` is a per-clone setting. Quiet on failure: a
 * published tarball or a container that never commits has nothing to gain from a failed install.
 */
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
} catch {
  // Not a git checkout, or nothing that will commit.
}
