/** Shadow-only probabilistic candidate based on verified unique server bytes and
 * active wait. It never proves impossibility and must not abort a session. */
export interface WsRatePolicyOptions {
  readonly warmupMs?: number
  readonly warmupBytes?: number
  readonly windowMs?: number
  readonly badWindows?: number
}

export class WsRatePolicy {
  private readonly warmupMs: number
  private readonly warmupBytes: number
  private readonly windowMs: number
  private readonly badWindows: number
  private baselineActiveMs: number | null = null
  private baselineBytes = 0
  private strikes = 0

  constructor(options: WsRatePolicyOptions = {}) {
    this.warmupMs = options.warmupMs ?? 30_000
    this.warmupBytes = options.warmupBytes ?? 256 * 1024
    this.windowMs = options.windowMs ?? 10_000
    this.badWindows = options.badWindows ?? 3
  }

  /** activeMs and verifiedBytes are cumulative and must never include client-reported counts. */
  observe(activeMs: number, verifiedBytes: number, remainingBytes: number, availableMs: number): boolean {
    if (remainingBytes <= 0 || availableMs <= 0) return false
    if (this.baselineActiveMs === null) {
      if (activeMs >= this.warmupMs && verifiedBytes >= this.warmupBytes) {
        this.baselineActiveMs = activeMs
        this.baselineBytes = verifiedBytes
      }
      return false
    }
    const elapsed = activeMs - this.baselineActiveMs
    if (elapsed < this.windowMs) return false
    const gained = Math.max(0, verifiedBytes - this.baselineBytes)
    const etaMs = gained > 0 ? remainingBytes * elapsed / gained : Infinity
    this.strikes = etaMs > 2 * availableMs ? this.strikes + 1 : 0
    this.baselineActiveMs = activeMs
    this.baselineBytes = verifiedBytes
    return this.strikes >= this.badWindows
  }
}
