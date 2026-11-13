import type { FlashTunnelConfig } from '@flash-tunnel/config'
import type { Emitter, PreviewSession } from '@flash-tunnel/core'
import type { FlashTunnelEvents, TunnelMode } from '@flash-tunnel/types'
import process from 'node:process'
import { createCloudflareDns, createCloudflareTunnel } from '@flash-tunnel/adapter-cloudflare'
import { startPreviewSession } from '@flash-tunnel/core'

export interface EmbeddedTunnelOptions {
  /** Origin URL already serving the local application. */
  localUrl: string
  /** Working directory used for session state and diagnostics. */
  cwd?: string
  mode?: Extract<TunnelMode, 'quick' | 'named'>
  /** Required for named tunnels. */
  hostname?: string
  /** Required for named tunnels. */
  zone?: string
  name?: string
  accountId?: string
  zoneId?: string
  apiToken?: string
  apiBase?: string
  cloudflaredPath?: string
  originRequest?: {
    httpHostHeader?: string
    noTLSVerify?: boolean
  }
  persist?: boolean
  keep?: boolean
  overwrite?: boolean
  autoStopAfterMs?: number
  verifyTimeoutMs?: number
  signal?: AbortSignal
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void
}

export interface EmbeddedTunnelSession {
  sessionId: string
  localUrl: string
  publicUrl: string
  hostname?: string
  expiresAt?: string
  events: Emitter<FlashTunnelEvents>
  exited: Promise<void>
  /** Stop cloudflared and remove resources owned by this session. */
  stop: () => Promise<void>
}

function toConfig(options: EmbeddedTunnelOptions, mode: 'quick' | 'named'): FlashTunnelConfig {
  return {
    server: { url: options.localUrl },
    domain: {
      zone: options.zone
    },
    tunnel: {
      mode,
      name: options.name
    },
    providers: {
      cloudflare: {
        accountId: options.accountId,
        zoneId: options.zoneId,
        cloudflaredPath: options.cloudflaredPath,
        originRequest: options.originRequest
      }
    },
    autoStopAfter: options.autoStopAfterMs
  }
}

function publicSession(session: PreviewSession): EmbeddedTunnelSession {
  return {
    sessionId: session.sessionId,
    localUrl: session.localUrl,
    publicUrl: session.publicUrl,
    hostname: session.hostname,
    expiresAt: session.expiresAt,
    events: session.events,
    exited: session.exited,
    stop: session.stop
  }
}

/**
 * Start a tunnel for an already-running local origin.
 *
 * The caller owns the local server lifecycle. This API only owns cloudflared
 * and any named-tunnel/DNS resources created for the session.
 */
export async function startTunnel(options: EmbeddedTunnelOptions): Promise<EmbeddedTunnelSession> {
  const mode = options.mode ?? 'quick'
  const apiToken = options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN
  const tunnel = createCloudflareTunnel({
    cloudflaredPath: options.cloudflaredPath,
    accountId: options.accountId,
    apiToken,
    apiBase: options.apiBase,
    originRequest: options.originRequest
  })
  const dns = mode === 'named'
    ? createCloudflareDns({
        apiToken: apiToken ?? '',
        zoneId: options.zoneId,
        apiBase: options.apiBase
      })
    : undefined

  if (mode === 'named' && (!options.hostname || !options.zone)) {
    throw new Error('Named tunnels require both hostname and zone')
  }

  const session = await startPreviewSession({
    cwd: options.cwd ?? process.cwd(),
    config: toConfig(options, mode),
    adapters: { tunnel, dns },
    mode,
    hostname: options.hostname,
    zone: options.zone,
    signal: options.signal,
    onLog: options.onLog,
    persist: options.persist,
    keep: options.keep,
    overwrite: options.overwrite,
    autoStopAfterMs: options.autoStopAfterMs,
    verifyTimeoutMs: options.verifyTimeoutMs
  })

  return publicSession(session)
}

export type { Emitter, PreviewSession } from '@flash-tunnel/core'
export type { FlashTunnelEvents, TunnelMode } from '@flash-tunnel/types'
