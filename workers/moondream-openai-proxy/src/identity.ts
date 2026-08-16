function ipv4Groups(value: string): [string, string] | null {
  const octets = value.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null
  }
  return [
    ((octets[0] ?? 0) * 256 + (octets[1] ?? 0)).toString(16),
    ((octets[2] ?? 0) * 256 + (octets[3] ?? 0)).toString(16),
  ]
}

function parseIpv6Side(value: string): string[] | null {
  if (!value) return []
  const parts = value.split(':')
  const finalPart = parts.at(-1)
  if (finalPart?.includes('.')) {
    const converted = ipv4Groups(finalPart)
    if (!converted) return null
    parts.splice(parts.length - 1, 1, ...converted)
  }
  return parts.every(part => /^[0-9a-f]{1,4}$/i.test(part)) ? parts : null
}

export function normalizeClientAddress(value: string): string {
  const address = value.trim().toLowerCase()
  if (!address.includes(':')) return address
  const halves = address.split('::')
  if (halves.length > 2) return address
  const left = parseIpv6Side(halves[0] ?? '')
  const right = parseIpv6Side(halves[1] ?? '')
  if (!left || !right) return address
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return address
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    .map(group => group.padStart(4, '0'))
  if (groups.length !== 8) return address

  if (groups.slice(0, 5).every(group => group === '0000') && groups[5] === 'ffff') {
    const high = Number.parseInt(groups[6] ?? '0', 16)
    const low = Number.parseInt(groups[7] ?? '0', 16)
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  return `${groups.slice(0, 4).join(':')}::/64`
}
