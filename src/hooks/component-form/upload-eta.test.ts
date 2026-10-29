import { describe, expect, it } from 'vitest'
import {
  formatRemainingMinutesRu,
  formatUploadSpeedRu,
  predictUploadEta,
  UPLOAD_LIMIT_WARNING_RU,
} from './upload-eta.js'

describe('predictUploadEta + форматирование скорости и минут', () => {
  it('форматирует скорость и корректно склоняет оставшиеся минуты по-русски', () => {
    expect(formatUploadSpeedRu(0)).toBe('')
    expect(formatUploadSpeedRu(512 * 1024)).toBe('512 КБ/с')
    expect(formatUploadSpeedRu(2.5 * 1024 * 1024)).toBe('2.5 МБ/с')

    expect(formatRemainingMinutesRu(24)).toBe('осталось менее 1 минуты (~24 с)')
    expect(formatRemainingMinutesRu(60)).toBe('осталась ~1 минута')
    expect(formatRemainingMinutesRu(150)).toBe('осталось ~3 минуты')
    expect(formatRemainingMinutesRu(300)).toBe('осталось ~5 минут')
    expect(formatRemainingMinutesRu(660)).toBe('осталось ~11 минут')
    expect(formatRemainingMinutesRu(1260)).toBe('осталась ~21 минута')
  })

  it('возвращает штатный прогноз в минутах на Vercel (300 с), когда средней скорости достаточно', () => {
    const forecast = predictUploadEta({
      phase: 'uploading',
      loadedBytes: 20 * 1024 * 1024,
      totalBytes: 140 * 1024 * 1024, // осталось 120 МБ
      bytesPerSecond: 1024 * 1024, // 1 МБ/с -> ~120 с = ~2 минуты (< 300 с)
      elapsedMs: 20_000,
      platform: 'vercel',
      maxDurationMs: 300_000,
    })

    expect(forecast.status).toBe('ok')
    expect(forecast.willExceedLimit).toBe(false)
    expect(forecast.etaMinutes).toBe(2)
    expect(forecast.remainingLabelRu).toBe('осталось ~2 минуты')
    expect(forecast.speedLabelRu).toBe('1.0 МБ/с')
    expect(forecast.warningTextRu).toBeNull()
  })

  it('выдаёт предупреждение остановить загрузку или разбить архиватором, если скорость не укладывается в лимит Vercel', () => {
    const forecast = predictUploadEta({
      phase: 'uploading',
      loadedBytes: 5 * 1024 * 1024,
      totalBytes: 105 * 1024 * 1024, // осталось 100 МБ
      bytesPerSecond: 256 * 1024, // 256 КБ/с -> ~400 с (~7 минут) > бюджета 300 с
      elapsedMs: 20_000,
      platform: 'vercel',
      maxDurationMs: 300_000,
    })

    expect(forecast.status).toBe('risk-timeout')
    expect(forecast.willExceedLimit).toBe(true)
    expect(forecast.etaMinutes).toBe(7)
    expect(forecast.remainingLabelRu).toBe('осталось ~7 минут')
    expect(forecast.warningTextRu).toBe(UPLOAD_LIMIT_WARNING_RU)
    expect(forecast.warningTextRu).toContain('рекомендуем остановить загрузку')
    expect(forecast.warningTextRu).toContain('разделить на части архиватором')
    expect(forecast.requiredBytesPerSecond).toBeGreaterThan(256 * 1024)
  })

  it('не выдаёт ложного предупреждения на Cloudflare Workers / Node.js без жёсткой отсечки времени даже при длинной загрузке', () => {
    const forecast = predictUploadEta({
      phase: 'uploading',
      loadedBytes: 10 * 1024 * 1024,
      totalBytes: 510 * 1024 * 1024, // осталось 500 МБ
      bytesPerSecond: 256 * 1024, // ~34 минуты
      elapsedMs: 40_000,
      platform: 'cloudflare',
      maxDurationMs: null,
    })

    expect(forecast.status).toBe('ok')
    expect(forecast.willExceedLimit).toBe(false)
    expect(forecast.etaMinutes).toBeGreaterThanOrEqual(33)
    expect(forecast.warningTextRu).toBeNull()
    expect(forecast.platformLabelRu).toContain('Cloudflare Workers')
  })

  it('корректно отражает состояния замера скорости и авто-дозагрузки после обрыва связи', () => {
    const measuring = predictUploadEta({
      phase: 'validating',
      loadedBytes: 0,
      totalBytes: 10 * 1024 * 1024,
      bytesPerSecond: 0,
      elapsedMs: 100,
      platform: 'node',
      maxDurationMs: null,
    })
    expect(measuring.status).toBe('measuring')
    expect(measuring.etaSeconds).toBeNull()

    const reconnecting = predictUploadEta({
      phase: 'reconnecting',
      loadedBytes: 2 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      bytesPerSecond: 512 * 1024,
      elapsedMs: 4_000,
      platform: 'vercel',
      maxDurationMs: 300_000,
      resumedCount: 1,
    })
    expect(reconnecting.status).toBe('reconnecting')
    expect(reconnecting.remainingLabelRu).toContain('авто-дозагрузка')
  })
})
