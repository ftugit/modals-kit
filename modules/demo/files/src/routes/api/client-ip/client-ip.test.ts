import { describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

describe('demo client-ip diagnostics', () => {
  it('returns the framework address and headers, but never echoes credentials', async () => {
    const getClientAddress = vi.fn(() => '198.51.100.10')
    const request = new Request('https://example.test/api/client-ip', {
      headers: {
        'cf-connecting-ip': '203.0.113.20',
        'x-forwarded-for': '203.0.113.21',
        'cdn-proxy-token': 'should-not-leak',
        'authorization': 'Bearer should-not-leak',
        'cookie': 'session=should-not-leak',
        'x-api-key': 'should-not-leak',
      },
    })
    const response = await GET({ request, getClientAddress } as unknown as Parameters<typeof GET>[0])
    const body = await response.json()

    expect(getClientAddress).toHaveBeenCalledOnce()
    expect(body.ip).toBe('198.51.100.10')
    expect(body.headers['cf-connecting-ip']).toBe('203.0.113.20')
    expect(body.headers['x-forwarded-for']).toBe('203.0.113.21')
    for (const name of ['cdn-proxy-token', 'authorization', 'cookie', 'x-api-key']) {
      expect(body.headers[name]).toBe('[redacted]')
    }
    expect(JSON.stringify(body)).not.toContain('should-not-leak')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
