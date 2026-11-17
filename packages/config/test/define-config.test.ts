import { describe, expect, it } from 'vitest'
import { defineConfig } from '../src'

describe('defineConfig', () => {
  it('returns the same object', () => {
    const config = {
      tunnel: { mode: 'quick' as const },
      server: { command: 'pnpm dev' }
    }

    expect(defineConfig(config)).toBe(config)
  })
})
