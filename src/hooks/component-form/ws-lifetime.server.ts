/** Pure calculations for the upload lifetime; times are milliseconds. */
export const DEFAULT_UPLOAD_TTL_MS = 300_000
export const DEFAULT_UPLOAD_IDLE_MS = 10_000
export const DEFAULT_UPLOAD_PAUSE_MAX_MS = 60_000
export const DEFAULT_UPLOAD_RATE_BUDGET_BYTES_PER_SEC = 32_768
export const PAUSE_PROGRESS_BYTES = 64 * 1024

/** Never grant more time than the configured application or known platform limit. */
export function uploadDeadline(startMs: number, ttlMs: number, platformDeadlineMs?: number | null): number {
  return Math.min(startMs + ttlMs, platformDeadlineMs ?? Number.POSITIVE_INFINITY)
}

/** Reserve time for storage completion and response; it is not a platform guarantee. */
export function finalizationReserve(ttlMs: number): number {
  return Math.min(8_000, Math.round(ttlMs * 0.08))
}

/** The application sees complete messages, not every byte arriving over TCP. */
export function dataWaitMs(idleMs: number, bytes: number, rateBytesPerSecond: number): number {
  return idleMs + Math.ceil(Math.max(0, bytes) * 1_000 / rateBytesPerSecond)
}

/** Pause is bounded by the remaining data budget and cannot extend the deadline. */
export function pauseDurationMs(remainingDataMs: number, pauseMaxMs: number, nextWaitMs: number): number {
  return Math.max(0, Math.min(pauseMaxMs, Math.floor(remainingDataMs / 4), remainingDataMs - nextWaitMs))
}

/** Reject contradictory configuration instead of silently clamping it. */
export function validateUploadConfiguration(ttlMs: number, idleMs: number, platformMs?: number | null): void {
  if (idleMs >= ttlMs - finalizationReserve(ttlMs)) {
    throw new Error('WS_UPLOAD_IDLE_SECONDS должен быть меньше TTL за вычетом резерва завершения')
  }
  if (platformMs != null && platformMs <= finalizationReserve(ttlMs)) {
    throw new Error('WS_UPLOAD_MAX_DURATION слишком мал для резерва завершения WS-загрузки')
  }
}
