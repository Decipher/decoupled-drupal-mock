import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findPrivateRefs, lintPrivateRefs } from './lint-private-refs.mjs'

const hosts = (text) => findPrivateRefs(text).map((hit) => hit.host)

describe('the private-host check', () => {
  it('finds link-local IPv4, a bracketed IPv6 literal, and an scp remote for any user', () => {
    expect(hosts('http://169.254.169.254/latest')).toEqual(['169.254.169.254'])
    expect(hosts('see http://[fd00::]/ and http://[fe80::1]:8080/')).toEqual(['fd00::', 'fe80::1'])
    expect(hosts('deploy@10.0.0.8:/srv/project.git')).toEqual(['10.0.0.8'])
    expect(hosts('git@gitlab.local:group/repo.git')).toEqual(['gitlab.local'])
  })

  it('finds a host with no dot in a URL, and reads a dot written for a regular expression', () => {
    expect(hosts('https://intranet/ and https://drupal/cms')).toEqual(['intranet', 'drupal'])
    expect(hosts('http://10\\.0\\.0\\.8/')).toEqual(['10.0.0.8'])
    expect(hosts("exclude = ['^http://127\\.0\\.0\\.1', '^https://www\\.drupal\\.org']")).toEqual([])
  })

  it('leaves a lock file\'s versions alone, which read like an scp remote', () => {
    expect(hosts('"@babel/core@npm:7.26.0", decoupled-drupal-mock@npm:^1.0.0')).toEqual([])
  })

  it('leaves an email address, a public host and the local development hosts alone', () => {
    expect(hosts('write to bob@corp.internal, or see https://www.drupal.org/i/1 and http://127.0.0.1:3005')).toEqual([])
  })

  it('reads what is staged, not what is in the worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'private-refs-'))
    try {
      const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
      git('init', '-q')
      writeFileSync(join(root, 'README.md'), 'Clone http://10.0.0.8/repo.git\n')
      git('add', 'README.md')
      writeFileSync(join(root, 'README.md'), 'Nothing here now.\n')
      expect(lintPrivateRefs(root)).toEqual(['README.md:1: 10.0.0.8'])
      // A submodule has no blob to read, and is not a file this repository publishes.
      git('update-index', '--add', '--cacheinfo', '160000,1111111111111111111111111111111111111111,vendored')
      expect(lintPrivateRefs(root)).toEqual(['README.md:1: 10.0.0.8'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
