import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
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
})
