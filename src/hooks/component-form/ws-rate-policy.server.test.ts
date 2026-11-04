import { describe, expect, it } from 'vitest'
import { WsRatePolicy } from './ws-rate-policy.server.js'

describe('probabilistic WS ETA policy', () => {
  it('waits for sufficient server-observed time and bytes plus three independent bad windows', () => {
    const p = new WsRatePolicy()
    expect(p.observe(29_000, 500_000, 10_000_000, 200_000)).toBe(false)
    expect(p.observe(30_000, 100_000, 10_000_000, 200_000)).toBe(false)
    expect(p.observe(30_000, 300_000, 10_000_000, 200_000)).toBe(false)
    expect(p.observe(40_000, 310_000, 10_000_000, 190_000)).toBe(false)
    expect(p.observe(50_000, 320_000, 10_000_000, 180_000)).toBe(false)
    expect(p.observe(60_000, 330_000, 10_000_000, 170_000)).toBe(true)
  })
  it('does not turn one long waiting interval into several independent windows', () => {
    const p = new WsRatePolicy()
    p.observe(30_000, 300_000, 10_000_000, 200_000)
    expect(p.observe(65_000, 301_000, 10_000_000, 165_000)).toBe(false)
    expect(p.observe(65_001, 301_001, 10_000_000, 165_000)).toBe(false)
  })
  it('resets strikes on a fast window and does not reject a completed file', () => {
    const p = new WsRatePolicy()
    p.observe(30_000, 300_000, 5_000_000, 150_000)
    p.observe(40_000, 301_000, 5_000_000, 140_000)
    p.observe(50_000, 302_000, 5_000_000, 130_000)
    expect(p.observe(60_000, 2_000_000, 3_000_000, 120_000)).toBe(false)
    expect(p.observe(70_000, 2_001_000, 3_000_000, 110_000)).toBe(false)
    expect(p.observe(80_000, 2_002_000, 3_000_000, 100_000)).toBe(false)
    expect(p.observe(90_000, 5_002_000, 0, 90_000)).toBe(false)
  })
  it('ignores repeated observations with no active waiting', () => {
    const p = new WsRatePolicy()
    p.observe(30_000, 300_000, 10_000_000, 200_000)
    for (let i = 0; i < 100; i++) expect(p.observe(30_000, 300_000, 10_000_000, 190_000 - i)).toBe(false)
  })
  it('exposes a false positive when a slow link later recovers within TTL', () => {
    // 256 KiB full WS messages, 16 KiB/s for 112 s then 256 KiB/s. Every
    // slow message arrives within idle + chunk/rateBudget (18 s). We continue
    // the hypothetical transfer after rejection solely to measure its outcome.
    const p = new WsRatePolicy()
    const size = 12 * 1024 * 1024, chunk = 256 * 1024, deadlineMs = 292_000
    let time = 0, bytes = 0, rejectedAt = 0
    while (bytes < size) {
      time += time < 112_000 ? 16_000 : 1_000
      bytes += chunk
      if (p.observe(time, bytes, size - bytes, deadlineMs - time) && !rejectedAt) rejectedAt = time
    }
    expect(rejectedAt).toBeGreaterThan(0)
    expect(time).toBeLessThan(deadlineMs) // would actually finish if allowed
  })

})
