import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadFlashTunnelConfig, resolveConfig } from '../src'

describe('tunnel configuration', () => {
  it('loads a tunnel-only config file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flash-tunnel-config-'))
    try {
      await writeFile(join(directory, 'flash-tunnel.ts'), `export default { tunnel: { mode: 'named', hostname: 'preview.example.com' } }`)
      const loaded = await loadFlashTunnelConfig(directory)
      expect(loaded.config.tunnel?.hostname).toBe('preview.example.com')
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('resolves quick mode without domain configuration', () => {
    const resolved = resolveConfig({ cwd: 'D:/Projects/demo', config: {} })
    expect(resolved.values.tunnel.mode).toBe('quick')
    expect(resolved.values.tunnel.hostname).toBeUndefined()
  })
})
