import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdapterRegistry, loadTunnelAdapter } from '../src'

describe('tunnel adapter loading', () => {
  it('loads a tunnel adapter from a local module', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flash-tunnel-adapter-'))
    try {
      await writeFile(join(directory, 'adapter.mjs'), `
        export default {
          kind: 'tunnel',
          id: 'local',
          apiVersion: 1,
          capabilities: { modes: ['quick'], publicHostname: 'assigned', concurrent: true },
          preflight: async () => {},
          provision: async (_ctx, spec) => ({ provider: 'local', tunnelId: '1', name: spec.name, secrets: {} }),
          start: async () => {},
          waitReady: async () => ({ state: 'connected', connections: 0 }),
          stop: async () => {},
          deprovision: async () => {}
        }
      `)

      const adapter = await loadTunnelAdapter('file:./adapter.mjs', directory)
      expect(adapter.id).toBe('local')
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('resolves registered tunnel adapters', async () => {
    const registry = new AdapterRegistry()
    const adapter = {
      kind: 'tunnel' as const,
      id: 'registered',
      apiVersion: 1 as const,
      capabilities: {
        modes: ['quick' as const],
        publicHostname: 'assigned' as const,
        concurrent: true
      },
      preflight: async () => {},
      provision: async (_ctx: unknown, spec: { name: string }) => ({
        provider: 'registered',
        tunnelId: '1',
        name: spec.name,
        secrets: {}
      }),
      start: async () => {},
      waitReady: async () => ({ state: 'connected' as const, connections: 0 }),
      stop: async () => {},
      deprovision: async () => {}
    }
    registry.registerTunnel('registered', () => adapter)

    await expect(registry.resolveTunnel('registered', process.cwd())).resolves.toBe(adapter)
  })
})
