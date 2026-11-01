/**
 * Связка `#lib/modals` × `#lib/paginate` × `#lib/address`:
 *
 * 1. Изолированный `ScopedStore` пагинатора на время жизни слота модалки (`slotKey = runtimeKey(name, index)`),
 *    освобождаемый строго по закрытию этого слота в `modals.chain` (а не по `onDestroy` внутреннего списка).
 * 2. Слоевой URL-транспорт `m<urlIndex>.<pageParam>` с общим владельцем `'modals'` (`C4`) для адресуемых
 *    модалок и чисто-памятевый режим (`url: false`) для эфемерных пикеров (`user.picker`).
 * 3. Поуровневое правило `claimLayerKeys` для `#lib/address`: при `go(-1)` сбрасывает только закрытые
 *    уровни `m<k>.*` (`k >= openUrlModalCount(targetUrl)`), сохраняя ключи живых родительских модалок.
 * 4. Поиск стора модалки-владельца `useOwnerPaginatorStore(paginatorName)` из дочерних модалок фильтров.
 */
import { claimLayerKeys } from '#lib/address/sveltekit.js'
import { entryLabel, runtimeKey, type ModalStore } from '#lib/modals/index.js'
import { tryUseModals, useInstance, useModal } from '#lib/modals/svelte/index.js'
import {
  acquireScopedStore,
  createPaginatorStore,
  findScopedStore,
  getClientStore,
  getPaginator,
  releaseScopedStore,
  type SessionUrlOptions,
  type Store,
} from '#lib/paginate/index.js'

const MODAL_LAYER_KEY_RE = /^m(\d+)\./

/** Число открытых в URL адресуемых модалок по параметру `modal` целевого адреса. */
export function openUrlModalCount(targetUrl?: URL): number {
  const raw = targetUrl?.searchParams.get('modal')
  if (!raw) return 0
  return raw.split(',').filter(Boolean).length
}

/** Предикат поуровневых слоевых ключей `m<k>.*` для `carried()` в `#lib/address`. */
export function isClosedModalLayerKey(key: string, targetUrl?: URL): boolean {
  const match = MODAL_LAYER_KEY_RE.exec(key)
  if (!match) return false
  return Number(match[1]) >= openUrlModalCount(targetUrl)
}

/** Регистрирует правило `m<k>.*` в `#lib/address` (повторяемо после `resetLayerKeys()` в тестах). */
export function registerModalLayerKeys(): void {
  claimLayerKeys(isClosedModalLayerKey)
}

registerModalLayerKeys()

export interface SlotPaginatorScope {
  readonly store: Store | undefined
  readonly scopeKey: string | null
  readonly paginatorUrl: boolean | SessionUrlOptions | undefined
}

// Один захват ScopedStore и одна подписка на закрытие слота на пару `(modals.store, slotKey)`:
// переключение вкладок внутри открытой модалки (`pick <-> chosen`) не плодит подписки и не теряет стор.
const heldByModalStore = new WeakMap<ModalStore, Map<string, Store>>()

export function acquireSlotStoreForModal(
  modalStore: ModalStore,
  modalName: string,
  modalIndex: number,
): { store: Store; slotKey: string } {
  const slotKey = runtimeKey(modalName, modalIndex)
  if (typeof window === 'undefined') {
    return { store: acquireScopedStore(slotKey), slotKey }
  }
  let bySlot = heldByModalStore.get(modalStore)
  if (!bySlot) {
    bySlot = new Map()
    heldByModalStore.set(modalStore, bySlot)
  }
  const existing = bySlot.get(slotKey)
  if (existing) {
    return { store: existing, slotKey }
  }
  const store = acquireScopedStore(slotKey)
  bySlot.set(slotKey, store)

  let released = false
  const release = () => {
    if (released) return
    released = true
    unsub()
    bySlot?.delete(slotKey)
    releaseScopedStore(slotKey)
  }
  const unsub = modalStore.subscribe((state) => {
    const entry = state.chain[modalIndex]
    if (!entry || entryLabel(entry) !== modalName) {
      release()
    }
  })
  // На случай если слот уже закрыт в момент подписки
  const nowEntry = modalStore.state.chain[modalIndex]
  if (!nowEntry || entryLabel(nowEntry) !== modalName) {
    release()
  }

  return { store, slotKey }
}

/**
 * Захватывает `ScopedStore` и вычисляет режим URL для пагинатора, смонтированного в модалке.
 * Вне модалки возвращает `{ store: undefined, scopeKey: null, paginatorUrl: options?.url }`.
 */
export function useSlotPaginatorScope(
  paginatorName: string,
  options?: { url?: boolean },
): SlotPaginatorScope {
  const m = tryUseModals()
  const instance = useInstance()
  if (!m || !instance) {
    return {
      store: undefined,
      scopeKey: null,
      paginatorUrl: options?.url,
    }
  }

  const modal = useModal()
  const { store, slotKey } = acquireSlotStoreForModal(m.modals.store, modal.name, modal.index)

  let paginatorUrl: boolean | SessionUrlOptions | undefined
  if (options?.url === false || modal.urlIndex === null) {
    paginatorUrl = false
  } else {
    const baseParam = getPaginator(paginatorName).adapter.pageParam
    paginatorUrl = baseParam
      ? { pageParam: `m${modal.urlIndex}.${baseParam}`, queryOwner: 'modals' }
      : false
  }

  return {
    store,
    scopeKey: slotKey,
    paginatorUrl,
  }
}

/**
 * Находит `Store` пагинатора `paginatorName` для дочерней модалки фильтров:
 * ищет ближайшую запись ниже текущей вершины `modals.chain`, чей живой `ScopedStore`
 * содержит коллекцию `paginatorName`; если такой нет — возвращает страничный `Store`.
 */
export function useOwnerPaginatorStore(paginatorName: string): Store {
  const m = tryUseModals()
  const instance = useInstance()
  if (m) {
    const chain = m.view.chain
    const startFrom = (instance ? instance.index : chain.length) - 1
    for (let i = startFrom; i >= 0; i--) {
      const entry = chain[i]
      if (!entry || entry.overrides?.headless) continue
      const found = findScopedStore(runtimeKey(entryLabel(entry), i))
      if (found?.has(paginatorName)) return found
    }
  }
  return typeof window !== 'undefined' ? getClientStore() : createPaginatorStore()
}
