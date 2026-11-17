import type { FlashTunnelConfig } from '@flash-tunnel/config'
import type { Emitter, PreviewSession } from '@flash-tunnel/core'
import type { FlashTunnelEvents, TunnelMode } from '@flash-tunnel/types'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process, { loadEnvFile } from 'node:process'
import { createCloudflareTunnel } from '@flash-tunnel/adapter-cloudflare'
import { startPreviewSession } from '@flash-tunnel/core'

export interface EmbeddedTunnelOptions {
  /** Origin URL already serving the local application. */
  localUrl: string
  /** Working directory used for session state and diagnostics. */
  cwd?: string
  /** Environment file to load. Defaults to cwd/.env when present. */
  envFile?: string
  mode?: Extract<TunnelMode, 'quick' | 'named'>
  /** Public hostname already configured in DNS for named tunnels. */
  hostname?: string
  name?: string
  cloudflaredPath?: string
  originRequest?: {
    httpHostHeader?: string
    noTLSVerify?: boolean
  }
  persist?: boolean
  keep?: boolean
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
    tunnel: {
      mode,
      name: options.name,
      hostname: options.hostname
    },
    providers: {
      cloudflare: {
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
 * and any named-tunnel resources created for the session.
 */
export async function startTunnel(options: EmbeddedTunnelOptions): Promise<EmbeddedTunnelSession> {
  loadEnvironment(options.envFile, options.cwd)
  const mode = options.mode ?? 'quick'
  const tunnel = createCloudflareTunnel({
    env: process.env,
    cloudflaredPath: options.cloudflaredPath,
    originRequest: options.originRequest
  })
  if (mode === 'named' && !options.hostname) {
    throw new Error('Named tunnels require a hostname already configured in DNS')
  }

  const session = await startPreviewSession({
    cwd: options.cwd ?? process.cwd(),
    config: toConfig(options, mode),
    adapters: { tunnel },
    mode,
    hostname: options.hostname,
    signal: options.signal,
    onLog: options.onLog,
    persist: options.persist,
    keep: options.keep,
    autoStopAfterMs: options.autoStopAfterMs,
    verifyTimeoutMs: options.verifyTimeoutMs
  })

  return publicSession(session)
}

function loadEnvironment(envFile?: string, cwd?: string): void {
  if (envFile) {
    loadEnvFile(resolve(envFile))
    return
  }

  const defaultEnvFile = resolve(cwd ?? process.cwd(), '.env')
  if (existsSync(defaultEnvFile)) {
    loadEnvFile(defaultEnvFile)
  }
}

export type { Emitter, PreviewSession } from '@flash-tunnel/core'
export type { FlashTunnelEvents, TunnelMode } from '@flash-tunnel/types'
