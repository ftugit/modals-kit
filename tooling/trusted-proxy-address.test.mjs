import test from 'node:test'
import assert from 'node:assert/strict'
import { trustedClientIp } from './trusted-proxy-address.mjs'

test('forged envoy address and client-supplied left XFF do not override an appended peer', () => {
  assert.equal(trustedClientIp({
    'x-envoy-external-address': '203.0.113.10',
    'x-forwarded-for': '203.0.113.10, 198.51.100.27',
  }), '198.51.100.27')
})

test('envoy alone is not evidence of client address; missing or malformed XFF fail closed', () => {
  assert.equal(trustedClientIp({ 'x-envoy-external-address': '203.0.113.10' }), undefined)
  for (const value of ['', '198.51.100.27,', '198.51.100.27, invalid', '198.51.100.27:1234', '[::1]']) {
    assert.equal(trustedClientIp({ 'x-forwarded-for': value }), undefined, value)
  }
})

test('multiple XFF fields use their last value, including valid IPv6', () => {
  assert.equal(trustedClientIp({ 'x-forwarded-for': ['203.0.113.10', '2001:db8::5'] }), '2001:db8::5')
  assert.equal(trustedClientIp({ 'x-forwarded-for': ['203.0.113.10', ''] }), undefined)
})
