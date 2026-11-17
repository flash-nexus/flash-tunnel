import type { TunnelAdapter } from '@flash-tunnel/types'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectServer, readSessionState, sessionLogPath, startPreviewSession } from '../src'

const directories: string[] = []
const sessions: Array<{ stop: () => Promise<void> }> = []
let home: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.FLASH_TUNNEL_HOME
  home = await mkdtemp(join(tmpdir(), 'flash-tunnel-home-'))
  process.env.FLASH_TUNNEL_HOME = home
})

async function createDirectory(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'flash-tunnel-session-'))
  directories.push(directory)

  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content)
  }

  return directory
}

function createFakeTunnel(mode: 'named' | 'quick' = 'quick', sequence: string[] = []): TunnelAdapter {
  let localUrl = ''

  return {
    kind: 'tunnel',
    id: 'fake-tunnel',
    apiVersion: 1,
    capabilities: {
      modes: [mode],
      publicHostname: mode === 'named'
        ? 'custom'
        : 'assigned',
      concurrent: true
    },
    preflight: async () => {
      sequence.push('tunnel:preflight')
    },
    provision: async (_ctx, spec) => {
      sequence.push('tunnel:provision')
      localUrl = spec.localUrl
      return {
        provider: 'fake-tunnel',
        tunnelId: 'tunnel-1',
        name: spec.name,
        publicUrl: undefined,
        target: mode === 'named'
          ? { type: 'CNAME', target: 'tunnel-1.cfargotunnel.com', proxied: true }
          : undefined,
        secrets: {},
        meta: { localUrl }
      }
    },
    start: async () => {
      sequence.push('tunnel:start')
    },
    waitReady: async (_ctx, handle) => ({
      state: 'connected',
      connections: 1,
      publicUrl: handle.publicUrl ?? localUrl
    }),
    stop: async () => {
      sequence.push('tunnel:stop')
    },
    deprovision: async () => {
      sequence.push('tunnel:deprovision')
    }
  }
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.stop().catch(() => {})))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  if (previousHome === undefined) {
    delete process.env.FLASH_TUNNEL_HOME
  }
  else {
    process.env.FLASH_TUNNEL_HOME = previousHome
  }
  await rm(home, { recursive: true, force: true })
})

describe('startPreviewSession', () => {
  it('starts the server, provisions the tunnel and stops both', async () => {
    const cwd = await createDirectory({
      'server.mjs': `
        import { createServer } from 'node:http'
        const server = createServer((request, response) => response.end('session-ok'))
        server.listen(0, '127.0.0.1', () => {
          console.log('Local: http://127.0.0.1:' + server.address().port)
        })
      `
    })

    const session = await startPreviewSession({
      cwd,
      config: {
        server: { command: 'node server.mjs', port: 0 }
      },
      adapters: {
        tunnel: createFakeTunnel()
      },
      mode: 'quick',
      verifyTimeoutMs: 10_000
    })
    sessions.push(session)

    expect(session.localUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(session.publicUrl).toBe(session.localUrl)
    expect(await (await fetch(session.publicUrl)).text()).toBe('session-ok')

    const serverLog = await readFile(sessionLogPath(cwd, session.sessionId, 'server'), 'utf8')
    expect(serverLog).toContain('Local: http://127.0.0.1')

    await session.stop()
    expect(await readSessionState(cwd)).toBeUndefined()
    await expect(fetch(session.localUrl)).rejects.toThrow()
  })

  it('prepares external resources after provision and cleans them before deprovision', async () => {
    const cwd = await createDirectory({
      'server.mjs': `
        import { createServer } from 'node:http'
        const server = createServer((request, response) => response.end('external-ok'))
        server.listen(0, '127.0.0.1', () => {
          console.log('Local: http://127.0.0.1:' + server.address().port)
        })
      `
    })
    const sequence: string[] = []

    const session = await startPreviewSession({
      cwd,
      config: {
        server: { command: 'node server.mjs', port: 0 }
      },
      adapters: {
        tunnel: createFakeTunnel('named', sequence)
      },
      mode: 'named',
      hostname: 'preview.example.com',
      prepare: async (_ctx, handle) => {
        expect(handle.target?.target).toBe('tunnel-1.cfargotunnel.com')
        sequence.push('external:ensure')
        return {
          provider: 'fake-external',
          ref: { id: 'record-1' },
          dispose: async () => {
            sequence.push('external:remove')
          }
        }
      },
      verifyTimeoutMs: 10_000
    })
    sessions.push(session)

    expect(sequence).toEqual([
      'tunnel:preflight',
      'tunnel:provision',
      'external:ensure',
      'tunnel:start'
    ])

    await session.stop()

    expect(sequence).toEqual([
      'tunnel:preflight',
      'tunnel:provision',
      'external:ensure',
      'tunnel:start',
      'tunnel:stop',
      'external:remove',
      'tunnel:deprovision'
    ])
  })

  it('can run a named tunnel without preparing external resources', async () => {
    const cwd = await createDirectory({
      'public/index.html': '<h1>named</h1>'
    })
    const serverPlan = detectServer(cwd, { dir: 'public', port: 0 })

    const session = await startPreviewSession({
      cwd,
      config: {},
      serverPlan,
      adapters: {
        tunnel: createFakeTunnel('named')
      },
      mode: 'named',
      hostname: 'preview.example.com',
      verifyTimeoutMs: 10_000
    })
    sessions.push(session)

    expect(session.publicUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})
