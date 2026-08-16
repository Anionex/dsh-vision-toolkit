import { describe, expect, it } from 'vitest'

import { normalizeClientAddress } from '../src/identity'

describe('normalizeClientAddress', () => {
  it('keeps IPv4 addresses stable', () => {
    expect(normalizeClientAddress('203.0.113.9')).toBe('203.0.113.9')
  })

  it('groups IPv6 privacy addresses by /64', () => {
    expect(normalizeClientAddress('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd:0012::/64')
    expect(normalizeClientAddress('2001:db8:abcd:12:ffff::2')).toBe('2001:0db8:abcd:0012::/64')
  })

  it('normalizes IPv4-mapped IPv6 addresses back to IPv4', () => {
    expect(normalizeClientAddress('::ffff:192.0.2.128')).toBe('192.0.2.128')
  })
})
