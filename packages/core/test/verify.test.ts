import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyPublicUrl } from '../src'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyPublicUrl', () => {
  it('accepts any non-5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 403 })))

    await expect(verifyPublicUrl('https://demo.example.com', { timeoutMs: 1000 }))
      .resolves
      .toMatchObject({ status: 403 })
  })

  it('rejects a request blocked by the Vite host check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'Blocked request. This host ("ft-abc.trycloudflare.com") is not allowed.\n'
      + 'To allow this host, add "ft-abc.trycloudflare.com" to `server.allowedHosts` in vite.config.js.',
      { status: 403 }
    )))

    await expect(verifyPublicUrl('https://ft-abc.trycloudflare.com', { timeoutMs: 1000 }))
      .rejects
      .toMatchObject({
        name: 'PublicHostBlockedError',
        host: 'ft-abc.trycloudflare.com'
      })
  })

  it('retries 5xx responses until the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 503 })))

    await expect(verifyPublicUrl('https://demo.example.com', {
      timeoutMs: 80,
      intervalMs: 20
    })).rejects.toThrow(/Timed out after 80ms/)
  })
})
