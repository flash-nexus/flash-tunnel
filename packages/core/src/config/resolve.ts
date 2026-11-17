import type { FlashTunnelConfig } from '@flash-tunnel/config'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { parseDuration, slugify } from '@flash-tunnel/utils'
import { FlashTunnelError } from '../errors'

export type ConfigSource = 'cli' | 'config' | 'default' | 'detected' | 'env'

export interface ConfigSourceInfo {
  source: ConfigSource
  note?: string
}

export type ConfigSources = Record<string, ConfigSourceInfo>

export interface ResolvedConfigValues {
  server: {
    command?: string
    cwd: string
    port?: number
    url?: string
    dir?: string
    timeout: number
  }
  tunnel: {
    provider: string
    mode: 'named' | 'quick'
    name: string
    hostname?: string
  }
  providers: {
    cloudflare: {
      cloudflaredPath: string
      originRequest?: {
        httpHostHeader?: string
        noTLSVerify?: boolean
      }
    }
  }
  autoStopAfter?: number
}

export interface ResolveConfigInput {
  cwd: string
  config: FlashTunnelConfig
  configFile?: string
  env?: NodeJS.ProcessEnv
  cli?: {
    hostname?: string
    mode?: string
    name?: string
    command?: string
    port?: string | number
    url?: string
    autoStop?: string
  }
  detected?: {
    command?: string
    port?: number
    dir?: string
    url?: string
    framework?: string
    reason?: string
    cwd?: string
  }
}

export interface ResolvedConfig {
  values: ResolvedConfigValues
  sources: ConfigSources
  warnings: string[]
  configDir: string
  configFile?: string
}

const KNOWN_FIELDS = new Set([
  'server',
  'tunnel',
  'providers',
  'autoStopAfter'
])

function invalid(message: string, hint?: string, cause?: unknown): FlashTunnelError {
  return new FlashTunnelError(message, {
    code: 'CONFIG_INVALID',
    exitCode: 2,
    hint,
    cause
  })
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value
    : undefined
}

function portNumber(value: string | number, path: string): number {
  const port = typeof value === 'string'
    ? Number(value)
    : value
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw invalid(`${path} must be an integer between 0 and 65535`, `Check ${path}`)
  }
  return port
}

function validateHostname(hostname: string): string {
  if (hostname.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname) || hostname.includes('..')) {
    throw invalid(`Invalid hostname "${hostname}"`, 'Use letters, digits, dots and hyphens')
  }
  return hostname.toLowerCase()
}

function firstOf<T>(...candidates: Array<readonly [T | undefined, ConfigSource, string?]>): { value?: T, source?: ConfigSource, note?: string } {
  for (const [value, source, note] of candidates) {
    if (value !== undefined) {
      return { value, source, note }
    }
  }
  return {}
}

export function resolveConfig(input: ResolveConfigInput): ResolvedConfig {
  const env = input.env ?? process.env
  const config = input.config
  const cli = input.cli ?? {}
  const configDir = input.configFile
    ? dirname(input.configFile)
    : resolve(input.cwd)
  const sources: ConfigSources = {}
  const warnings: string[] = []

  for (const field of Object.keys(config)) {
    if (!KNOWN_FIELDS.has(field)) {
      warnings.push(`Unknown configuration field "${field}"`)
    }
  }

  const serverCwd = optionalString(config.server?.cwd)
    ? isAbsolute(config.server!.cwd!)
      ? config.server!.cwd!
      : resolve(configDir, config.server!.cwd!)
    : configDir
  sources['server.cwd'] = {
    source: config.server?.cwd ? 'config' : 'default'
  }

  const commandPick = firstOf<string>(
    [
      optionalString(cli.command),
      'cli'
    ],
    [
      optionalString(env.FLASH_TUNNEL_COMMAND),
      'env'
    ],
    [
      optionalString(config.server?.command),
      'config'
    ],
    [
      optionalString(input.detected?.command),
      'detected',
      input.detected?.reason
    ]
  )
  if (commandPick.value !== undefined) {
    sources['server.command'] = {
      source: commandPick.source!,
      ...(commandPick.note
        ? { note: commandPick.note }
        : {})
    }
  }

  const urlPick = firstOf<string>(
    [
      optionalString(cli.url),
      'cli'
    ],
    [
      optionalString(config.server?.url),
      'config'
    ],
    [
      optionalString(input.detected?.url),
      'detected'
    ]
  )
  if (urlPick.value !== undefined) {
    if (!URL.canParse(urlPick.value)) {
      throw invalid(`server.url is not a valid URL: "${urlPick.value}"`)
    }
    sources['server.url'] = { source: urlPick.source! }
  }

  const portPick = firstOf<string | number>(
    [cli.port, 'cli'],
    [
      optionalString(env.FLASH_TUNNEL_PORT),
      'env'
    ],
    [config.server?.port, 'config'],
    [input.detected?.port, 'detected']
  )
  const port = portPick.value === undefined || portPick.value === ''
    ? undefined
    : portNumber(portPick.value, 'server.port')
  if (port !== undefined) {
    sources['server.port'] = { source: portPick.source! }
  }

  const timeout = config.server?.timeout ?? 60_000
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw invalid('server.timeout must be a positive integer')
  }
  sources['server.timeout'] = {
    source: config.server?.timeout === undefined
      ? 'default'
      : 'config'
  }

  const modePick = firstOf<string>(
    [
      optionalString(cli.mode),
      'cli'
    ],
    [
      optionalString(env.FLASH_TUNNEL_MODE),
      'env'
    ],
    [
      optionalString(config.tunnel?.mode),
      'config'
    ]
  )
  const mode = modePick.value ?? 'quick'
  if (mode !== 'named' && mode !== 'quick') {
    throw invalid(`tunnel.mode must be "named" or "quick"`)
  }
  sources['tunnel.mode'] = { source: modePick.source ?? 'default' }

  const hostnamePick = firstOf<string>(
    [
      optionalString(cli.hostname),
      'cli'
    ],
    [
      optionalString(env.FLASH_TUNNEL_HOSTNAME),
      'env'
    ],
    [
      optionalString(config.tunnel?.hostname),
      'config'
    ]
  )
  const hostname = hostnamePick.value
    ? validateHostname(hostnamePick.value)
    : undefined
  if (hostname) {
    sources['tunnel.hostname'] = { source: hostnamePick.source! }
  }

  const provider = optionalString(config.tunnel?.provider) ?? 'cloudflare'
  const name = optionalString(cli.name)
    ?? optionalString(config.tunnel?.name)
    ?? `flash-tunnel-${slugify(basename(input.cwd))}`
  sources['tunnel.provider'] = {
    source: config.tunnel?.provider ? 'config' : 'default'
  }
  sources['tunnel.name'] = {
    source: cli.name
      ? 'cli'
      : config.tunnel?.name ? 'config' : 'default'
  }

  const cloudflaredPath = optionalString(env.FLASH_TUNNEL_CLOUDFLARED) ?? config.providers?.cloudflare?.cloudflaredPath ?? 'cloudflared'
  const autoStopPick = firstOf<string | number>(
    [cli.autoStop, 'cli'],
    [
      optionalString(env.FLASH_TUNNEL_AUTO_STOP),
      'env'
    ],
    [config.autoStopAfter, 'config']
  )
  let autoStopAfter: number | undefined
  if (autoStopPick.value !== undefined) {
    try {
      autoStopAfter = parseDuration(autoStopPick.value)
    }
    catch (error) {
      throw invalid(`autoStopAfter is invalid: ${error instanceof Error
        ? error.message
        : String(error)}`)
    }
    sources.autoStopAfter = { source: autoStopPick.source! }
  }

  return {
    values: {
      server: {
        command: commandPick.value,
        cwd: serverCwd,
        port,
        url: urlPick.value,
        dir: config.server?.dir,
        timeout
      },
      tunnel: { provider, mode, name, hostname },
      providers: {
        cloudflare: {
          cloudflaredPath,
          originRequest: config.providers?.cloudflare?.originRequest
        }
      },
      autoStopAfter
    },
    sources,
    warnings,
    configDir,
    configFile: input.configFile
  }
}
