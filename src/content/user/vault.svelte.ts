/**
 * Vault — хранилище состояния входа одной вкладки (модуль-одиночка, НЕ
 * провайдер и не hooks-автопроверка). Компоненты читают его реактивное
 * состояние; после авторизации/продления все потребители перерисовываются
 * сами — перезапуск не нужен.
 *
 * Модель токенов (владелец, ход 251): ОБА токена — HttpOnly-куки, ставит
 * только сервер по явному POST; временный дополнительно живёт ЗДЕСЬ, в RAM.
 * Значение приходит из ответа api (`hydrate`, `mirror`) и из данных страницы.
 *
 * Автопродление без глобального инжекта: таймер взводится фактом присутствия
 * токена (кто-то получил ответ api — значит компонент есть). Выстрел за
 * `max(5%, 60 с)` до конца (джиттер внутри окна — `vault.ts`); перед выстрелом
 * и под замком `navigator.locks` (анти-толпа): без замка гонку всё равно
 * гасит сервер — одноразовость токена продления + перечитывание куки.
 * Продление — POST на именованный экшен (по умолчанию `/user/auth?/renew`):
 * ответ приносит новое значение access — RAM и кука сходятся.
 */
import { fireAt, leadFor, overdue, parseRenewResponse, type RenewData } from './vault.js'

export type VaultProfile = { nickname: string | null; avatarUrl: string | null }

/** Что кладёт в vault данные страницы (load) и ответы api. */
export type VaultPayload = RenewData

class Vault {
  /** RAM-копия временного токена; нет — вкладка не авторизована (для виджета). */
  access = $state<string | null>(null)
  /** Кто я и витрина профиля (из токена последнего продления/сохранения). */
  principal = $state<string | null>(null)
  profile = $state<VaultProfile>({ nickname: null, avatarUrl: null })
  /** Продление идёт (кнопки/потребители могут показать честное состояние). */
  renewing = $state(false)

  private expiresAt = 0
  private ttlMs = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Адрес именованного экшена продления. */
  renewUrl = '/user/auth?/renew'

  /** Данные страницы или успешного ответа api (вход, продление, профиль). */
  hydrate(payload: VaultPayload): void {
    this.access = payload.access
    this.principal = payload.sub
    this.profile = payload.prof
    this.expiresAt = payload.expiresAt
    this.ttlMs = payload.ttlMs
    this.schedule()
  }

  /** Выход: RAM очищается (куки снял сервер в экшене). */
  clear(): void {
    this.access = null
    this.principal = null
    this.profile = { nickname: null, avatarUrl: null }
    this.expiresAt = 0
    this.ttlMs = 0
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Взвести таймер: точка выстрела — внутри лид-окна (джиттер). */
  private schedule(): void {
    if (typeof window === 'undefined' || this.expiresAt === 0) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    const delay = Math.max(0, fireAt(this.expiresAt, this.ttlMs) - Date.now())
    this.timer = setTimeout(() => void this.renew(), delay)
  }

  /**
   * Страховка перед любым вызовом api: не пора ли раньше таймера (вкладка
   * спала, таймеры тормозили). Истёкший access продлится молча по куке.
   */
  maybeRenew(): void {
    if (this.expiresAt !== 0 && overdue(this.expiresAt, Date.now())) void this.renew()
  }

  /**
   * Продление. Анти-толпа: под замком `navigator.locks`; владелец замка
   * postит экшен, остальные дожидаются очереди и читают свежее состояние —
   * их выстрел отменяется, если срок уже обновлён (перечитывание зеркала).
   */
  async renew(): Promise<void> {
    if (typeof window === 'undefined' || this.access === null || this.renewing) return
    this.renewing = true
    try {
      const lockName = 'modals-kit:user:renew'
      const nav = navigator as Navigator & { locks?: LockManager }
      if (nav.locks) {
        await nav.locks.request(lockName, async () => {
          if (Date.now() < this.expiresAt - leadFor(this.ttlMs) + leadFor(this.ttlMs) * 0.5) return
          await this.postRenew()
        })
      } else {
        await this.postRenew()
      }
    } catch {
      // сеть/экшен упали — таймер перезведётся при следующем ответе api
    } finally {
      this.renewing = false
    }
  }

  private async postRenew(): Promise<void> {
    const response = await fetch(this.renewUrl, {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return
    const parsed = parseRenewResponse(await response.json())
    if (parsed) this.hydrate(parsed)
  }
}

/** Одиночка вкладки: один на JavaScript-контекст, состояние реактивное. */
export const vault = new Vault()

/** Прислать в vault значение из ответа api/данных страницы (обёртка для адаптеров). */
export function hydrateVault(payload: VaultPayload): void {
  vault.hydrate(payload)
}
