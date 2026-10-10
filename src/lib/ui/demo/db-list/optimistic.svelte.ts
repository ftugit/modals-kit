/**
 * Оптимистичная строка демо-БД — состояние списка, А НЕ часть источника.
 *
 * Почему не в источнике: у источника есть контракт «страница по ключам адреса», и
 * строка, которой нет ни в одном ответе, сделала бы из него хранилище догадок.
 * Здесь карточка живёт в окне: `totalItems` она не меняет, в `?page.after` не
 * участвует (серверный курсор перепрыгнул бы её) и исчезняет, когда настоящая
 * строка приезжает из источника сама.
 *
 * Жизненный цикл — тот, что описан в `docs/LIVE-APPEND.md` §2.1 (и в TanStack, и в
 * здравом смысле): запись в состояние ДО ответа, замена на месте по снимку, откат
 * по опции при неудаче.
 *
 * Привязка «эта отправка = эта карточка» идёт по ключу, а НЕ по заголовку: в
 * `demo_post` на `title` нет уникальности (индекс `demo_post_page` — про порядок),
 * так что два одинаковых заголовка — законные две строки. Дедупликация по тексту
 * молча съедала бы вторую вставку.
 */
import type { DbPost, FailureMode } from './definition'

export type OptimisticState = 'pending' | 'failed' | 'settled'

export type OptimisticCard = {
  /** Временный ключ: серверного `id` у карточки ещё нет, и выдумывать его нельзя. */
  tmpId: string
  title: string
  state: OptimisticState
  /** Причина отказа — текстом, карточка показывает её, а не молча исчезает. */
  error?: string
  /** Строка из ответа: карточка заменяется ЕЙ на том же месте (без скачка). */
  row?: DbPost
}

export type Optimistic = {
  list: () => OptimisticCard[]
  /** Панель меняет режим отказа — значение, а не ссылка на extra: момент чтения = миг отказа. */
  setFailureMode: (mode: FailureMode) => void
  /**
   * Новая карточка; `reuseId` — карточка этой же отправки (повтор после отказа),
   * тогда вторая копия не появляется. Без `reuseId` одна и та же строка,
   * отправленная дважды, даёт ДВЕ карточки: на сервере это две разные записи.
   */
  begin: (title: string, reuseId?: string | null) => string
  confirm: (tmpId: string, row: DbPost) => void
  fail: (tmpId: string, message: string) => void
  retry: (tmpId: string) => void
  drop: (tmpId: string) => void
  /** Форма регистрирует способ отправить себя ещё раз (кнопка «повторить»). */
  setResubmit: (fn: () => void) => void
  /** Сколько карточек сейчас в полёте (для счётчика и для «не спамить»). */
  inflight: () => number
}

export function createOptimistic(): Optimistic {
  let resubmit: (() => void) | undefined
  let cards = $state<OptimisticCard[]>([])
  let failure: FailureMode = $state('retry')
  const find = (tmpId: string): OptimisticCard | undefined => cards.find((c) => c.tmpId === tmpId)
  const write = (next: OptimisticCard[]): void => {
    cards = next
  }

  return {
    list: () => cards,
    setFailureMode: (m) => {
      failure = m
    },
    setResubmit: (fn) => {
      resubmit = fn
    },
    begin(title, reuseId) {
      const open = reuseId ? find(reuseId) : undefined
      // «settled» не переиспользуется: её строка уже на сервере, и повтор той же
      // отправки — это НОВАЯ запись (или отказ), а не возврат к той же карточке.
      if (open && open.state !== 'settled') {
        write(cards.map((c) => (c === open ? { ...c, state: 'pending', error: undefined } : c)))
        return open.tmpId
      }
      const card: OptimisticCard = { tmpId: `tmp:${crypto.randomUUID()}`, title, state: 'pending' }
      write([...cards, card])
      return card.tmpId
    },
    confirm(tmpId, row) {
      const card = find(tmpId)
      if (!card) return
      write(cards.map((c) => (c === card ? { ...c, state: 'settled', row, error: undefined } : c)))
    },
    fail(tmpId, message) {
      const card = find(tmpId)
      if (!card) return
      if (failure === 'remove') {
        write(cards.filter((c) => c !== card))
        return
      }
      write(cards.map((c) => (c === card ? { ...c, state: 'failed', error: message } : c)))
    },
    retry(tmpId) {
      const card = find(tmpId)
      if (!card) return
      write(cards.map((c) => (c === card ? { ...c, state: 'pending', error: undefined } : c)))
      // Отправка — за формой; здесь только перевод карточки в «в полёте», чтобы
      // `begin` внутри этой же отправки узнал её и не создал дубль.
      resubmit?.()
    },
    drop(tmpId) {
      write(cards.filter((c) => c.tmpId !== tmpId))
    },
    inflight: () => cards.filter((c) => c.state === 'pending').length,
  }
}

/**
 * Куда встаёт карточка: «за последним id» в терминах порядка, а не в конец DOM.
 * При `created_at DESC` свежие — в начале, значит и карточка в начало; при
 * `created_at ASC` — в хвост. Порядок по `title` честнее сказать как есть: место
 * определит сервер (строка сортируется по значению, которого у карточки нет),
 * поэтому она остаётся в голове, а подпись в интерфейсе это и называет.
 */
export function pendingPlacement(order: string | undefined): 'head' | 'tail' {
  if (!order || order === 'default') return 'head'
  let pairs: unknown
  try {
    pairs = JSON.parse(order)
  } catch {
    return 'head'
  }
  const first = Array.isArray(pairs) ? pairs[0] : undefined
  if (!Array.isArray(first) || first.length !== 2) return 'head'
  const [field, dir] = first as [string, string]
  if (dir === 'asc' && field === 'created_at') return 'tail'
  return 'head'
}

/**
 * Карточка больше не нужна, если ЕЁ СТРОКА уже в видимых строках. Сопоставление
 * только по `id`: у карточки в полёте его ещё нет, и подставлять вместо него
 * заголовок нельзя (он не уникален) — иначе «похожая» строка убила бы честную.
 * Цена — краткий миг, когда опрос принёс запись раньше ответа формы: карточка
 * переживёт его и исчезнет в момент `confirm`.
 */
export function isAbsorbed(card: OptimisticCard, rows: readonly DbPost[]): boolean {
  return card.row ? rows.some((r) => r.id === card.row!.id) : false
}
