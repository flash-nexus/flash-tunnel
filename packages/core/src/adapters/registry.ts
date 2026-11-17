import type { TunnelAdapter } from '@flash-tunnel/types'
import { loadTunnelAdapter } from './load'

export type TunnelFactory = () => TunnelAdapter

/**
 * Built-in adapters are registered by the CLI; anything not registered is
 * treated as `npm:package`, `file:./adapter.mjs` or a local path.
 */
export class AdapterRegistry {
  private readonly tunnels = new Map<string, TunnelFactory>()

  registerTunnel(id: string, factory: TunnelFactory): void {
    this.tunnels.set(id, factory)
  }

  listTunnels(): string[] {
    return [
      ...this.tunnels.keys()
    ]
  }

  async resolveTunnel(id: string, cwd: string): Promise<TunnelAdapter> {
    const factory = this.tunnels.get(id)
    if (factory) {
      return factory()
    }
    return loadTunnelAdapter(id, cwd)
  }
}
