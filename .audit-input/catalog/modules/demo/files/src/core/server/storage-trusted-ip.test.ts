import { describe, expect, it } from 'vitest'
import { resolveRequestMeta } from './storage.server.js'

describe('demo storage request metadata', () => {
  const request = () => new Request('https://example.test/file', {
    headers: { 'x-real-ip': '203.0.113.99', 'x-forwarded-for': '203.0.113.98' },
  })

  it('uses only the framework address when available', () => {
    expect(resolveRequestMeta(request(), { getClientAddress: () => '::ffff:192.0.2.42' }).ip).toBe('192.0.2.42')
  })

  it('does not turn spoofed headers into a client address without an event', () => {
    expect(resolveRequestMeta(request()).ip).toBe('127.0.0.1')
  })

  it('does not turn spoofed headers into an address if the adapter cannot supply one', () => {
    expect(resolveRequestMeta(request(), { getClientAddress: () => { throw new Error('unavailable') } }).ip).toBe('127.0.0.1')
  })
})
