// Изоморфный расчёт скорости, оставшихся минут и риска превышения лимита платформы для `wss://`-загрузки.
import type { FormUploadProgress, WsUploadPlatform } from './ws-protocol.js'

export interface UploadEtaInput {
  readonly phase: FormUploadProgress['phase']
  readonly loadedBytes: number
  readonly totalBytes: number
  readonly bytesPerSecond: number
  readonly elapsedMs: number
  readonly platform: WsUploadPlatform
  readonly maxDurationMs: number | null
  readonly resumedCount?: number
}

export interface UploadEtaForecast {
  /** Статус прогноза: ожидание замера, штатный ход, восстановление связи, финализация или риск отсечки по лимиту платформы. */
  readonly status: 'measuring' | 'ok' | 'risk-timeout' | 'reconnecting' | 'processing' | 'done'
  /** Оценка оставшегося времени передачи в секундах (`null`, пока скорость ещё не измерена). */
  readonly etaSeconds: number | null
  /** Округлённое вверх число оставшихся минут (`null`, пока скорость не измерена). */
  readonly etaMinutes: number | null
  /** Готовая русская строка оценки оставшегося времени (например «осталось ~3 минуты» или «осталось менее 1 минуты (~25 с)»). */
  readonly remainingLabelRu: string
  /** Отформатированная текущая скорость (например «1.4 МБ/с» или «320 КБ/с»). */
  readonly speedLabelRu: string
  /** Описание платформы и её лимита времени жизни одного соединения. */
  readonly platformLabelRu: string
  /** Превысит ли загрузка оставшийся бюджет времени платформы при текущей средней скорости. */
  readonly willExceedLimit: boolean
  /** Минимальная требуемая скорость (байт/с), чтобы успеть до отсечки платформы (`null`, если лимита нет). */
  readonly requiredBytesPerSecond: number | null
  /** Рекомендация пользователю при нехватке скорости под лимит платформы (`null` в штатном режиме). */
  readonly warningTextRu: string | null
}

/** Человекочитаемое форматирование объёма байтов на русском языке. */
export function formatUploadBytesRu(bytes: number): string {
  const safe = Math.max(0, bytes)
  if (safe < 1024) return `${Math.round(safe)} Б`
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} КБ`
  if (safe < 1024 * 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(1)} МБ`
  return `${(safe / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

/** Человекочитаемое форматирование скорости отдачи (`Б/с`, `КБ/с`, `МБ/с`). */
export function formatUploadSpeedRu(bytesPerSecond: number | undefined | null): string {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return ''
  }
  if (bytesPerSecond < 1024) {
    return `${Math.round(bytesPerSecond)} Б/с`
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${Math.round(bytesPerSecond / 1024)} КБ/с`
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} МБ/с`
}

/** Склонение существительного «минута» в конструкции «осталось ~N ...». */
export function pluralizeMinutesRu(minutes: number): {
  verb: 'осталась' | 'осталось'
  noun: 'минута' | 'минуты' | 'минут'
} {
  const n = Math.abs(Math.trunc(minutes))
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 19) {
    return { verb: 'осталось', noun: 'минут' }
  }
  if (mod10 === 1) {
    return { verb: 'осталась', noun: 'минута' }
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return { verb: 'осталось', noun: 'минуты' }
  }
  return { verb: 'осталось', noun: 'минут' }
}

/** Сформировать русскую фразу оставшегося времени с акцентом на минуты. */
export function formatRemainingMinutesRu(etaSeconds: number): string {
  const sec = Math.max(0, Math.ceil(etaSeconds))
  if (sec <= 0) return 'завершается…'
  if (sec < 60) {
    return `осталось менее 1 минуты (~${sec} с)`
  }
  const minutes = Math.ceil(sec / 60)
  const { verb, noun } = pluralizeMinutesRu(minutes)
  return `${verb} ~${minutes} ${noun}`
}

function describePlatformRu(platform: WsUploadPlatform, maxDurationMs: number | null): string {
  if (maxDurationMs !== null && maxDurationMs > 0) {
    const totalSec = Math.round(maxDurationMs / 1000)
    const label =
      platform === 'vercel'
        ? 'Vercel Functions'
        : platform === 'cloudflare'
          ? 'Cloudflare'
          : 'Сервер'
    if (totalSec >= 60 && totalSec % 60 === 0) {
      return `${label} (лимит соединения ${totalSec / 60} мин)`
    }
    return `${label} (лимит соединения ${totalSec} с)`
  }
  if (platform === 'cloudflare') {
    return 'Cloudflare Workers (без отсечки по времени потока)'
  }
  return 'Node.js (без жёсткого лимита времени)'
}

/** Текст предупреждения при нехватке скорости для укладывания в лимит времени платформы. */
export const UPLOAD_LIMIT_WARNING_RU =
  'Скорость соединения недостаточна и не укладывается в лимит времени платформы: рекомендуем остановить загрузку и выбрать файлы поменьше или разделить на части архиватором.'

/**
 * Рассчитать оставшееся время загрузки в минутах и проверить укладывание потока в лимит платформы.
 */
export function predictUploadEta(input: UploadEtaInput): UploadEtaForecast {
  const remainingBytes = Math.max(0, input.totalBytes - input.loadedBytes)
  const speedLabelRu = formatUploadSpeedRu(input.bytesPerSecond)
  const platformLabelRu = describePlatformRu(input.platform, input.maxDurationMs)

  if (input.phase === 'done') {
    return {
      status: 'done',
      etaSeconds: 0,
      etaMinutes: 0,
      remainingLabelRu: 'загрузка завершена',
      speedLabelRu,
      platformLabelRu,
      willExceedLimit: false,
      requiredBytesPerSecond: null,
      warningTextRu: null,
    }
  }

  if (input.phase === 'reconnecting') {
    return {
      status: 'reconnecting',
      etaSeconds: null,
      etaMinutes: null,
      remainingLabelRu: 'восстановление соединения (авто-дозагрузка)…',
      speedLabelRu,
      platformLabelRu,
      willExceedLimit: false,
      requiredBytesPerSecond: null,
      warningTextRu: null,
    }
  }

  if (input.phase === 'processing' || (input.phase === 'uploading' && remainingBytes === 0)) {
    return {
      status: 'processing',
      etaSeconds: 0,
      etaMinutes: 0,
      remainingLabelRu: 'фиксация файла в хранилище…',
      speedLabelRu,
      platformLabelRu,
      willExceedLimit: false,
      requiredBytesPerSecond: null,
      warningTextRu: null,
    }
  }

  if (input.bytesPerSecond <= 0 || input.phase === 'validating') {
    return {
      status: 'measuring',
      etaSeconds: null,
      etaMinutes: null,
      remainingLabelRu: 'оцениваем скорость соединения…',
      speedLabelRu,
      platformLabelRu,
      willExceedLimit: false,
      requiredBytesPerSecond: null,
      warningTextRu: null,
    }
  }

  const etaSeconds = Math.ceil(remainingBytes / input.bytesPerSecond)
  const etaMinutes = Math.max(1, Math.ceil(etaSeconds / 60))
  const remainingLabelRu = formatRemainingMinutesRu(etaSeconds)

  if (input.maxDurationMs === null || input.maxDurationMs <= 0) {
    return {
      status: 'ok',
      etaSeconds,
      etaMinutes,
      remainingLabelRu,
      speedLabelRu,
      platformLabelRu,
      willExceedLimit: false,
      requiredBytesPerSecond: null,
      warningTextRu: null,
    }
  }

  // Резервируем до 8 секунд (или 8% бюджета на коротких стендовых лимитах) на финальную запись и commit()
  const commitReserveMs = Math.min(8_000, Math.round(input.maxDurationMs * 0.08))
  const remainingBudgetMs = Math.max(0, input.maxDurationMs - input.elapsedMs - commitReserveMs)
  const requiredBytesPerSecond =
    remainingBudgetMs > 0
      ? Math.ceil(remainingBytes / (remainingBudgetMs / 1000))
      : Number.POSITIVE_INFINITY

  // Защита от ложной тревоги на самых первых миллисекундах прогрева сокета, если превышение пограничное
  const settledMeasurement =
    input.elapsedMs >= 600 || etaSeconds * 1000 > input.maxDurationMs * 1.1
  const willExceedLimit =
    settledMeasurement &&
    (remainingBudgetMs <= 0 || etaSeconds * 1000 > remainingBudgetMs)

  return {
    status: willExceedLimit ? 'risk-timeout' : 'ok',
    etaSeconds,
    etaMinutes,
    remainingLabelRu,
    speedLabelRu,
    platformLabelRu,
    willExceedLimit,
    requiredBytesPerSecond: Number.isFinite(requiredBytesPerSecond)
      ? requiredBytesPerSecond
      : null,
    warningTextRu: willExceedLimit ? UPLOAD_LIMIT_WARNING_RU : null,
  }
}
