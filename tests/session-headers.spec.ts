import { describe, expect, it } from 'vitest'
import { createSessionHeaderRouter } from '../src/session-headers.ts'

describe('session header routing identity', () => {
  it('is stable for one operation key, isolated across sessions, and opaque', () => {
    const route = createSessionHeaderRouter(Buffer.alloc(32, 1))
    const workspaceKey = 'workspace:/Users/alice/private-project'
    const first = route(['x-opencode-session', 'x-session-route'], workspaceKey)

    expect(first).toEqual(route(['x-opencode-session', 'x-session-route'], workspaceKey))
    expect(first['x-opencode-session']).toMatch(/^[0-9a-f]{32}$/u)
    expect(first['x-session-route']).toBe(first['x-opencode-session'])
    expect(first['x-opencode-session']).not.toContain('alice')
    expect(route(['x-opencode-session'], 'session:other')['x-opencode-session'])
      .not.toBe(first['x-opencode-session'])
  })

  it('rotates when a new process secret is created', () => {
    const firstProcess = createSessionHeaderRouter(Buffer.alloc(32, 1))
    const secondProcess = createSessionHeaderRouter(Buffer.alloc(32, 2))

    expect(firstProcess(['x-opencode-session'], 'session:stable'))
      .not.toEqual(secondProcess(['x-opencode-session'], 'session:stable'))
  })

  it('returns no headers when the feature is not configured', () => {
    expect(createSessionHeaderRouter(Buffer.alloc(32, 1))([], 'workspace:/private/path')).toEqual({})
  })
})
