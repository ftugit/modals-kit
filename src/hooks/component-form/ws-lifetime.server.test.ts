import { describe, expect, it } from 'vitest'
import { dataWaitMs, finalizationReserve, pauseDurationMs, uploadDeadline, validateUploadConfiguration } from './ws-lifetime.server.js'

describe('upload lifetime calculations', () => {
  it('never extends the application or known platform deadline', () => {
    expect(uploadDeadline(1_000, 300_000)).toBe(301_000)
    expect(uploadDeadline(1_000, 300_000, 280_000)).toBe(280_000)
    expect(uploadDeadline(1_000, 300_000, 400_000)).toBe(301_000)
  })
  it('allows for a complete segment and reserves finalization time', () => {
    expect(dataWaitMs(10_000, 256 * 1024, 32 * 1024)).toBe(18_000)
    expect(finalizationReserve(300_000)).toBe(8_000)
    expect(finalizationReserve(20_000)).toBe(1_600)
  })
  it('shrinks pauses and never consumes time reserved for the next segment', () => {
    expect(pauseDurationMs(285_000, 60_000, 18_000)).toBe(60_000)
    expect(pauseDurationMs(32_000, 60_000, 18_000)).toBe(8_000)
    expect(pauseDurationMs(17_000, 60_000, 18_000)).toBe(0)
    expect(pauseDurationMs(300_000, 0, 18_000)).toBe(0)
  })
  it('rejects incompatible configured durations', () => {
    expect(() => validateUploadConfiguration(300_000, 10_000, 300_000)).not.toThrow()
    expect(() => validateUploadConfiguration(10_000, 10_000)).toThrow(/WS_UPLOAD_IDLE_SECONDS/)
    expect(() => validateUploadConfiguration(300_000, 10_000, 5_000)).toThrow(/WS_UPLOAD_MAX_DURATION/)
  })
  it('bounds pause for many combinations of remaining time and limits', () => {
    for (let remaining = 0; remaining <= 300_000; remaining += 431) {
      const duration = pauseDurationMs(remaining, 60_000, 18_000)
      expect(duration).toBeGreaterThanOrEqual(0)
      expect(duration).toBeLessThanOrEqual(60_000)
      expect(duration).toBeLessThanOrEqual(remaining)
      if (duration > 0) expect(duration + 18_000).toBeLessThanOrEqual(remaining)
    }
  })
})
