import { describe, expect, it } from 'vitest'
import type { Cookies } from '@sveltejs/kit'
import { countryOf, subnetOf, type AuthEvent } from './gateway.server.js'

const cookies = {} as Cookies
const request = new Request('https://example.test/', { headers: { 'cf-ipcountry': 'US', 'x-real-ip': '203.0.113.40' } })

describe('authentication proxy context', () => {
  it('ignores raw geo and IP headers in an unverified request', () => {
    const event: AuthEvent = { request, cookies, getClientAddress: () => '192.0.2.45' }
    expect(countryOf(event)).toBeUndefined()
    expect(subnetOf(request, event)).toBe('192.0.2.0')
  })
  it('uses the verified geo context and framework address', () => {
    const event: AuthEvent = { request, cookies, locals: { edge: { geoRegion: 'DE-HE' } }, getClientAddress: () => '198.51.100.91' }
    expect(countryOf(event)).toBe('DE-HE')
    expect(subnetOf(request, event)).toBe('198.51.100.0')
  })
})
