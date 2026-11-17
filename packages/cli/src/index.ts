import type { FlashTunnelConfig } from '@flash-tunnel/config'
import type { PreviewSession, SessionCleaner, SessionState } from '@flash-tunnel/core'
import type { Command } from 'cac'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process, { loadEnvFile } from 'node:process'
import { CloudflareApi, createCloudflareTunnel } from '@flash-tunnel/adapter-cloudflare'
import { cleanSessions, detectServer, loadFlashTunnelConfig, resolveConfig, startPreviewSession } from '@flash-tunnel/core'
import { cac } from 'cac'

interface StartOptions {
  cwd?: string
  config?: string
  envFile?: string
  url?: string
  command?: string
  port?: string
  hostname?: string
  mode?: string
  name?: string
  autoStop?: string
  dryRun?: boolean
  keep?: boolean
  json?: boolean
  verbose?: boolean
}

interface CleanOptions {
  session?: string
  stale?: boolean
  all?: boolean
  dryRun?: boolean
  yes?: boolean
  force?: boolean
}

function readVersion(): Promise<string> {
  return readFile(new URL('../package.json', import.meta.url), 'utf8')
    .then(value => (JSON.parse(value) as { version?: string }).version ?? '0.0.0')
    .catch(() => '0.0.0')
}

function loadEnvironment(envFile: string | undefined, cwd: string): void {
  const file = envFile
    ? resolve(cwd, envFile)
    : resolve(cwd, '.env')
  if (envFile || existsSync(file)) {
    loadEnvFile(file)
  }
}

function output(value: unknown, json = false): void {
  process.stdout.write(json
    ? `${JSON.stringify(value)}\n`
    : `${typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2)}\n`)
}

function effectiveConfig(config: FlashTunnelConfig, resolved: ReturnType<typeof resolveConfig>): FlashTunnelConfig {
  return {
    ...config,
    server: {
      ...config.server,
      ...resolved.values.server
    },
    tunnel: {
      ...config.tunnel,
      ...resolved.values.tunnel
    },
    providers: {
      ...config.providers,
      cloudflare: {
        ...config.providers?.cloudflare,
        ...resolved.values.providers.cloudflare
      }
    },
    autoStopAfter: resolved.values.autoStopAfter
  }
}

function createCleaner(): SessionCleaner | undefined {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN
  if (!apiToken) {
    return undefined
  }
  const api = new CloudflareApi({
    apiToken,
    apiBase: process.env.FLASH_TUNNEL_CLOUDFLARE_API_BASE
  })
  return {
    removeTunnel: async (state: SessionState) => {
      if (!state.tunnel || state.tunnel.mode !== 'named') {
        return
      }
      if (!state.tunnel.accountId) {
        throw new Error('Session is missing the Cloudflare account id')
      }
      const tunnel = await api.getTunnel(state.tunnel.accountId, state.tunnel.tunnelId)
      if (tunnel.name !== state.tunnel.name) {
        throw new Error(`Refusing to delete tunnel ${state.tunnel.tunnelId}: name does not match the session record`)
      }
      await api.cleanupConnections(state.tunnel.accountId, state.tunnel.tunnelId).catch(() => {})
      await api.deleteTunnel(state.tunnel.accountId, state.tunnel.tunnelId).catch((error) => {
        if (!(error instanceof Error) || !/NOT_FOUND/i.test(error.message)) {
          throw error
        }
      })
    }
  }
}

async function stopOnSignals(session: PreviewSession): Promise<void> {
  await new Promise<void>((resolveStop) => {
    const stop = (): void => {
      void session.stop().finally(resolveStop)
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    session.exited.then(() => {
      if (!session.stopping) {
        void session.stop().finally(resolveStop)
      }
    })
  })
}

async function runStart(options: StartOptions): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  loadEnvironment(options.envFile, cwd)
  const loaded = await loadFlashTunnelConfig(cwd, { config: options.config })
  const config = loaded.config
  const serverPlan = detectServer(cwd, {
    ...config.server,
    ...(options.url
      ? { url: options.url, command: undefined, dir: undefined }
      : {}),
    ...(options.command
      ? { command: options.command }
      : {}),
    ...(options.port
      ? {
          port: Number(options.port)
        }
      : {})
  })
  const resolved = resolveConfig({
    cwd,
    config,
    configFile: loaded.source,
    cli: {
      command: options.command,
      mode: options.mode,
      hostname: options.hostname,
      name: options.name,
      url: options.url,
      port: options.port,
      autoStop: options.autoStop
    },
    detected: serverPlan
  })

  if (options.dryRun) {
    output({ config: resolved.values, sources: resolved.sources, warnings: resolved.warnings }, options.json)
    return
  }

  const mode = resolved.values.tunnel.mode
  const hostname = resolved.values.tunnel.hostname
  if (mode === 'named' && !hostname) {
    throw new Error('Named tunnels require --hostname or tunnel.hostname')
  }

  const tunnel = createCloudflareTunnel({
    accountId: resolved.values.providers.cloudflare.accountId,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    cloudflaredPath: resolved.values.providers.cloudflare.cloudflaredPath,
    apiBase: process.env.FLASH_TUNNEL_CLOUDFLARE_API_BASE,
    originRequest: resolved.values.providers.cloudflare.originRequest
  })
  const session = await startPreviewSession({
    cwd,
    config: effectiveConfig(config, resolved),
    serverPlan,
    adapters: { tunnel },
    mode,
    hostname,
    keep: options.keep,
    autoStopAfterMs: resolved.values.autoStopAfter,
    configSource: loaded.source,
    onLog: options.verbose
      ? line => process.stderr.write(`${line}\n`)
      : undefined
  })

  output({
    localUrl: session.localUrl,
    publicUrl: session.publicUrl,
    sessionId: session.sessionId,
    hostname: session.hostname
  }, options.json)

  if (session.autoStopped) {
    await session.autoStopped
  }
  else {
    await stopOnSignals(session)
  }
}

async function runClean(options: CleanOptions): Promise<void> {
  if (options.all && !options.yes) {
    throw new Error('clean --all requires --yes')
  }
  const results = await cleanSessions({
    sessionId: options.session,
    staleOnly: options.stale,
    all: options.all,
    dryRun: options.dryRun,
    force: options.force,
    cleaner: options.dryRun
      ? undefined
      : createCleaner()
  })
  output(results)
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const cli = cac('flash-tunnel')
  const withStartOptions = (command: Command): Command => command
    .option('--cwd <dir>', 'Project directory')
    .option('--config <path>', 'Path to flash-tunnel.ts')
    .option('--env-file <path>', 'Environment file')
    .option('--url <url>', 'Local origin URL')
    .option('--command <command>', 'Local server command')
    .option('--port <port>', 'Local server port')
    .option('--hostname <fqdn>', 'Already-configured public hostname')
    .option('--mode <mode>', 'Tunnel mode: quick or named')
    .option('--name <name>', 'Tunnel name')
    .option('--auto-stop <duration>', 'Stop after a duration')
    .option('--keep', 'Keep the tunnel after exit')
    .option('--dry-run', 'Print resolved tunnel configuration')
    .option('--json', 'Print machine-readable JSON')
    .option('--verbose', 'Print tunnel logs')

  withStartOptions(cli.command('[root]', 'Start a tunnel')).action((_root: unknown, options: StartOptions = {}) => runStart(options))
  withStartOptions(cli.command('start', 'Start a tunnel')).action((options: StartOptions = {}) => runStart(options))
  cli.command('clean', 'Clean stale tunnel sessions')
    .option('--session <id>', 'Session id')
    .option('--stale', 'Only stale sessions')
    .option('--all', 'All sessions')
    .option('--dry-run', 'Show cleanup actions')
    .option('--yes', 'Confirm cleaning all sessions')
    .option('--force', 'Clean running sessions')
    .action((options: CleanOptions = {}) => runClean(options))
  cli.help()
  cli.version(await readVersion())
  await cli.parse(argv)
}

export { runCli as runCliFromProcess }
