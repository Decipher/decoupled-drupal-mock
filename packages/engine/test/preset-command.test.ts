import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'

const root = join(__dirname, '..', '..', '..')
// Every directory under presets/ that holds a package is a preset package.
const presets = readdirSync(join(root, 'presets')).filter((name) => existsSync(join(root, 'presets', name, 'package.json')))

const freePort = (): Promise<number> => new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  })
})

describe.each(presets)('the %s preset package', (preset) => {
  const dir = join(root, 'presets', preset)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string, bin?: string | Record<string, string>, files: string[] }

  // npm names a command given as a string after the package, and removes one whose path starts with ./ when it publishes.
  it('has a command named after the package, which it publishes', () => {
    expect(manifest.bin).toBe('bin.js')
    expect(manifest.files).toContain('bin.js')
  })

  it('serves its own build with the options serve takes, so npx runs it in one command', async () => {
    const port = await freePort()
    const child = spawn(process.execPath, [join(dir, 'bin.js'), '--port', String(port), '--no-cors'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    // A command that hangs before it prints keeps the worker alive past the timeout unless this stops it.
    onTestFinished(() => {
      child.kill()
    })
    const line = await new Promise<string>((resolve, reject) => {
      let output = ''
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (output.includes('listening on')) resolve(output.trim())
      })
      child.stderr.on('data', (chunk: Buffer) => reject(new Error(chunk.toString('utf8'))))
      child.on('exit', (code) => reject(new Error(`exited with ${code}`)))
    })
    expect(line).toMatch(new RegExp(`listening on http://127\\.0\\.0\\.1:${port}$`))
    // The build it serves is this package's, not another preset's.
    const build = JSON.parse(readFileSync(join(dir, 'dump', 'manifest.json'), 'utf8')) as { preset: string }
    expect(line.startsWith(`${build.preset} from Drupal `)).toBe(true)
    const response = await fetch(`http://127.0.0.1:${port}/jsonapi`, { headers: { Origin: 'https://frontend.test' } })
    expect(response.status).toBe(200)
    // --no-cors reached the server, so the options are the engine's own.
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  }, 30000)

  it('starts in the background, says whether it runs, and stops, so a script needs no polling loop', async () => {
    const port = String(await freePort())
    const pidFile = join(mkdtempSync(join(tmpdir(), 'ddm-preset-')), 'mock.pid')
    const run = (...args: string[]) => {
      const { status, stdout, stderr } = spawnSync(process.execPath, [join(dir, 'bin.js'), ...args, '--port', port, '--pid-file', pidFile], { cwd: root, encoding: 'utf8' })
      return { status, output: `${stdout}${stderr}`.trim() }
    }
    onTestFinished(() => {
      run('stop')
    })
    const build = JSON.parse(readFileSync(join(dir, 'dump', 'manifest.json'), 'utf8')) as { preset: string }
    expect(run('status')).toEqual({ status: 1, output: `No mock is running on port ${port}.` })
    const started = run('start', '--no-cors')
    expect(started.status).toBe(0)
    // The same line serve prints, so the logs read the same.
    expect(started.output).toMatch(new RegExp(`^${build.preset} from Drupal .+, listening on http://127\\.0\\.0\\.1:${port}$`))
    const response = await fetch(`http://127.0.0.1:${port}/jsonapi`, { headers: { Origin: 'https://frontend.test' } })
    expect(response.status).toBe(200)
    // The serve options reached the server in the background too.
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(run('status')).toMatchObject({ status: 0, output: expect.stringMatching(new RegExp(`^${build.preset} is running on http://127\\.0\\.0\\.1:${port}, pid \\d+\\.$`)) })
    expect(run('stop')).toMatchObject({ status: 0, output: expect.stringMatching(/^Stopped the mock on port \d+, pid \d+\.$/) })
    expect(run('stop')).toEqual({ status: 0, output: `No mock is running on port ${port}.` })
    expect(run('start', '--ready-timeout', 'soon')).toEqual({ status: 1, output: '--ready-timeout is a number of seconds, not soon.' })
  }, 30000)
})
