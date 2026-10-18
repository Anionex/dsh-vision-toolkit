import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveVisionCredential } from '../src/credentials-compat.ts'

const ref = credentialRef('VISION_TEST_CREDENTIAL')
const context = (values: Record<string, unknown>) => ({ get: (name: string) => values[name] }) as never

describe('profile credential resolution', () => {
  it('reads the headless launch snapshot without an interactive credential service', async () => {
    const ctx = context({ launchEnvironment: { get: () => ({ value: 'fixture', source: 'project-env' }) } })
    expect(await resolveVisionCredential(ctx, ref)).toEqual({ value: 'fixture', source: 'project-env' })
  })
  it('keeps an interactive provider authoritative even when the reference is absent', async () => {
    const ctx = context({ credentials: { resolve: async () => undefined }, launchEnvironment: { get: () => ({ value: 'stale', source: 'process' }) } })
    expect(await resolveVisionCredential(ctx, ref)).toBeUndefined()
  })
  it('propagates credential provider failures without silently changing the source', async () => {
    const ctx = context({ credentials: { resolve: async () => { throw new Error('unavailable') } } })
    await expect(resolveVisionCredential(ctx, ref)).rejects.toThrow('unavailable')
  })
  it('treats empty launch credentials as unconfigured', async () => {
    const ctx = context({ launchEnvironment: { get: () => ({ value: '', source: 'process' }) } })
    expect(await resolveVisionCredential(ctx, ref)).toBeUndefined()
  })
})
