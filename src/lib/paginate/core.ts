// Действия ядра пагинатора над Store (SPEC §3.3). Vanilla: сервер (loader) + клиент.
// Дословный порт core.ts React-версии: jotai-store → Store из store.ts, логика 1-в-1
// (reqId-гонки, эхо-guard, pending-скелетоны, события, persist).
import { canLoadMore, deriveMeta, flattenPages } from './pure'
import type { LibError } from './types'
import { getPaginator, type PaginatorInstance } from './registry'
import { initialState, type Store } from './store'
import type { AdapterInit, AdapterInitContext, Extra, ExtraValue, PageResponse, PaginatorState } from './types'

export function getState<T>(store: Store, name: string): PaginatorState<T> {
  return store.state<T>(name)()
}

function patch<T>(
  store: Store,
  name: string,
  fn: (s: PaginatorState<T>) => PaginatorState<T>,
): void {
  store.update<T>(name, fn)
}

/**
 * Разослать конверт по приёмникам инстанса (Q1). Эмиттер событий — не здесь:
 * `type:'error'` уже уходит подписчикам до notify. Бросок sink'а РАСПРОСТРАНЯЕТСЯ:
 * так серверный фатал доезжает до SvelteKit-500 (см. `onError` в README-контракте).
 */
export function notifyError(
  instance: PaginatorInstance,
  code: LibError['code'],
  cause: unknown,
  ctx?: Record<string, unknown>,
): void {
  for (const sink of instance.errorSinks) sink({ lib: 'paginate', code, cause, ctx })
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * persist не критичен для отображения: состояние не ломается (SPEC §3.3).
 * Q1: вместо `console.warn` — конверт `persist-failed` в приёмники (хост решает
 * консоль/что-то ещё; warn'ом более не владеем — канал единый).
 */
export function safePersist(store: Store, name: string): void {
  const instance = getPaginator(name)
  const report = (error: unknown) => {
    try {
      notifyError(instance, 'persist-failed', error, { via: 'persist' })
    } catch {
      /* sink бросил (DEV throw) — от async-цепочки нам не долететь, глушим
         УЖЕ оглашённое: бросок случился, обработчик видел. */
    }
  }
  try {
    const result = instance.adapter.persist(getState<unknown>(store, name))
    if (result instanceof Promise) result.catch(report)
  } catch (error) {
    // синхронный бросок: notify наружу НЕ глушим — серверный фатал обязан дожить
    // до load; DEV-throw here виден как есть.
    notifyError(instance, 'persist-failed', error, { via: 'persist' })
  }
}

/**
 * Единая точка replace-fetch (init/goToPage/onExternalPage): reqId-гард от гонок (D4),
 * REPLACE-доставка, scroll-to-top, события. Ошибка НЕ теряет загруженные страницы (§8).
 */

/**
 * Буфер опережающей загрузки живёт на экземпляре реестра (переживает unmount хоста).
 * Хранит полный ответ источника: `items` без meta теряли бы `hasNext`
 * (порт фикса shiki-search-lib; баг базы 038773a).
 */
function prefetchBuffer<T>(
  instance: PaginatorInstance,
): Map<number, PageResponse<T>> {
  const holder = instance as PaginatorInstance & { prefetched?: Map<number, PageResponse<unknown>> }
  if (!holder.prefetched) holder.prefetched = new Map()
  return holder.prefetched as Map<number, PageResponse<T>>
}

/**
 * Сброс буфера: содержимое страницы зависит от extra/pageSize, и после их смены
 * предзагруженная страница — данные из другого набора. Без этого смена фильтра
 * или поискового запроса показывала бы старую страницу из буфера.
 */
function dropPrefetched(instance: PaginatorInstance): void {
  const holder = instance as PaginatorInstance & { prefetched?: Map<number, unknown>; prefetchGen?: number }
  holder.prefetched?.clear()
  /**
   * Поколение буфера. Полётный prefetch, начатый ДО сброса, обязан выбросить свой
   * ответ: он относится к другому набору данных, а приедет в текущий и подменит
   * страницу, которую только что запросили с новым фильтром.
   */
  holder.prefetchGen = (holder.prefetchGen ?? 0) + 1
}

/**
 * Полётные предзагрузки экземпляра. Hover и focus по одной и той же ссылке — это
 * два вызова на один запрос: без множества «уже грузится» мгновенный клик стоил
 * двух одинаковых обращений к данным (замер логом сети на превью: ×3 на клик).
 */
function prefetchInflight(instance: PaginatorInstance): Set<number> {
  const holder = instance as PaginatorInstance & { prefetchInflight?: Set<number> }
  holder.prefetchInflight ??= new Set<number>()
  return holder.prefetchInflight
}
/**
 * Ответ источника дописывает свои ключи extra (указатель следующего шага).
 *
 * Отдельная функция, а не `setExtra`: этот путь никогда не перезагружает выдачу.
 * Ключ, выданный загрузкой страницы, попал бы в `reloadKeys`-семантику, и каждый
 * ответ сбрасывал бы список на первую страницу — то есть на сам себя.
 *
 * Deny-safe как у `setExtra`: либо ключ объявлен (`adapter.extraKeys()`), либо
 * предупреждение и отбрасывание. `''`/null — снять ключ (источник сказал
 * «дальше некуда»).
 */
function mergeResponseExtra<T>(store: Store, name: string, resp: PageResponse<T>): void {
  const incoming = resp.extra
  if (!incoming) return
  const instance = getPaginator(name)
  const declared = instance.adapter.extraKeys?.()
  const known = declared ? new Set(declared) : null
  const state = getState<T>(store, name)
  const next: Extra = { ...state.extra }
  let changed = false
  for (const [key, value] of Object.entries(incoming)) {
    if (known && !known.has(key)) {
      console.warn(
        `paginate: источник «${instance.name}» вернул ключ extra «${key}», которого нет среди объявленных; ключ записан не был.`,
      )
      continue
    }
    if (value === undefined || value === null || value === '') {
      if (key in next) {
        delete next[key]
        changed = true
      }
      continue
    }
    if (next[key] !== value) {
      next[key] = value
      changed = true
    }
  }
  if (!changed) return
  patch<T>(store, name, (s) => ({
    ...s,
    extra: next,
    capabilities: instance.adapter.capabilitiesFor(next),
  }))
  safePersist(store, name)
}

export async function fetchReplace<T>(
  store: Store,
  name: string,
  page: number,
  phase: 'init' | 'replace',
): Promise<void> {
  const instance = getPaginator(name)
  // Прерываем предыдущий replace-запрос (D22: AbortController для replace/goToPage/reset)
  if (instance.replaceAbort) {
    instance.replaceAbort.abort()
  }
  const ac = new AbortController()
  instance.replaceAbort = ac

  // Если страница была тихо предзагружена через prefetchPage (hover), используем её мгновенно.
  // В буфере лежит ВЕСЬ ответ источника, а не только items: раньше сохранялся массив,
  // и `hasNext` терялся — для источника без totalItems (поиск, курсор) это означало
  // «дальше неизвестно» сразу после перехода по предзагруженной ссылке.
  const prefetched = prefetchBuffer<T>(instance).get(page)
  if (prefetched && prefetched.items.length > 0 && phase === 'replace') {
    prefetchBuffer<T>(instance).delete(page)
    const state = getState<T>(store, name)
    const meta = deriveMeta(
      { ...prefetched, totalPages: prefetched.totalPages ?? state.totalPages ?? undefined },
      state.pageSize,
      page,
    )
    patch<T>(store, name, (s) => ({
      ...s,
      status: 'idle',
      page,
      totalPages: meta.totalPages ?? s.totalPages,
      totalItems: meta.totalItems ?? s.totalItems,
      hasNext: meta.hasNext ?? s.hasNext,
      hasPrev: page > 1 ? null : false,
      loadedPages: [page],
      pages: { [page]: prefetched.items },
      pending: null,
      error: null,
    }))
    mergeResponseExtra<T>(store, name, prefetched)
    instance.scrollDriver?.({ type: 'top' })
    instance.emitter.emit({ type: 'loaded', page, itemCount: prefetched.items.length, via: phase })
    return
  }

  const reqId = getState<T>(store, name).reqId + 1
  patch<T>(store, name, (s) => ({
    ...s,
    reqId,
    page,
    status: 'loading',
    error: null,
    // D17: REPLACE-скелетоны = pageSize слотов pending-группы.
    pending: { page, mode: 'replace', count: s.pageSize },
  }))
  let resp: PageResponse<T>
  try {
    resp = (await instance.adapter.loadPage({
      page,
      pageSize: getState<T>(store, name).pageSize,
      extra: getState<T>(store, name).extra,
      signal: ac.signal,
    })) as PageResponse<T>
  } catch (error) {
    if (ac.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return // отменённый запрос тихо завершается
    }
    if (getState<T>(store, name).reqId !== reqId) return // устарел — гонку выиграл другой запрос
    patch<T>(store, name, (s) => ({
      ...s,
      status: 'error',
      error: errMessage(error),
      pending: null,
    }))
    instance.emitter.emit({ type: 'error', error, page, phase })
    notifyError(instance, 'load-failed', error, { page, phase })
    return
  }
  if (ac.signal.aborted || getState<T>(store, name).reqId !== reqId) return // устарел — reset победил (T2.5)
  if (instance.replaceAbort === ac) instance.replaceAbort = null
  const pageSize = getState<T>(store, name).pageSize
  const meta = deriveMeta(resp, pageSize, page)
  patch<T>(store, name, (s) => ({
    ...s,
    pages: { [page]: resp.items },
    loadedPages: [page],
    totalItems: meta.totalItems,
    totalPages: meta.totalPages,
    hasNext: meta.hasNext,
    hasPrev: page > 1 ? null : false,
    status: 'idle',
    error: null,
    pending: null,
  }))
  // Указатель следующего шага — из того же ответа, что и строки: отдельного
  // «узнать курсор» запроса быть не может, а ссылка обязана его нести.
  mergeResponseExtra<T>(store, name, resp)
  instance.scrollDriver?.({ type: 'top' })
  if (resp.items.length === 0) instance.emitter.emit({ type: 'empty-page', page })
  instance.emitter.emit({ type: 'loaded', page, itemCount: resp.items.length, via: phase })
}

/**
 * Идемпотентен: status !== 'init' → no-op (повторный mount безопасен).
 * Порт: вызывается хостом БЕЗУСЛОВНО на mount (React-версия пропускала вызов при
 * snapshot) — идемпотентность закрывает латентный разрыв D15: патченный stale-снапшот
 * (status 'init', page из URL) обязан догрузиться, иначе UI зависал в notReady.
 */
export async function initPaginator<T>(
  store: Store,
  name: string,
  ctx?: AdapterInitContext,
): Promise<void> {
  const instance = getPaginator(name)
  if (getState<T>(store, name).status !== 'init') return
  let init: AdapterInit<T>
  try {
    init = (await instance.adapter.getInitial(ctx)) as AdapterInit<T>
  } catch (error) {
    patch<T>(store, name, (s) => ({ ...s, status: 'error', error: errMessage(error) }))
    instance.emitter.emit({ type: 'error', error, page: null, phase: 'init' })
    notifyError(instance, 'init-failed', error, { page: null, phase: 'init' })
    return
  }
  // Гонка (T4.7): пока getInitial был в полёте, externalPage/goToPage могли стартовать
  // свой fetchReplace — не затираем его более поздним init.
  if (getState<T>(store, name).status !== 'init') return
  const pageSize = init.pageSize ?? instance.pageSize
  // extra: восстановленные ключи потребителя поверх текущих (дефолты роута кладутся до init).
  const extra: Extra = { ...getState<T>(store, name).extra, ...(init.extra ?? {}) }
  if (init.preloaded) {
    const preloaded = init.preloaded
    const loadedPages = Object.keys(preloaded)
      .map(Number)
      .sort((a, b) => a - b)
    patch<T>(store, name, (s) => ({
      ...s,
      page: init.page,
      pageSize,
      extra,
      capabilities: instance.adapter.capabilitiesFor(extra),
      sourceState: init.sourceState,
      totalItems: init.totalItems ?? null,
      totalPages: init.totalPages ?? null,
      hasNext: init.hasNext ?? null,
      hasPrev: init.page > 1 ? null : false,
      pages: preloaded,
      loadedPages,
      status: 'idle',
    }))
    instance.emitter.emit({ type: 'page-changed', page: init.page, via: 'init' })
    const itemCount = flattenPages(getState<T>(store, name)).length
    if (itemCount === 0) instance.emitter.emit({ type: 'empty-page', page: init.page })
    instance.emitter.emit({ type: 'loaded', page: init.page, itemCount, via: 'init' })
    return
  }
  // Нет preloaded: подкрасить meta из хранилища (R6), затем fetch первой страницы.
  patch<T>(store, name, (s) => ({
    ...s,
    page: init.page,
    pageSize,
    extra,
    capabilities: instance.adapter.capabilitiesFor(extra),
    sourceState: init.sourceState ?? s.sourceState,
    totalItems: init.totalItems ?? s.totalItems,
    totalPages: init.totalPages ?? s.totalPages,
    hasNext: init.hasNext ?? s.hasNext,
  }))
  instance.emitter.emit({ type: 'page-changed', page: init.page, via: 'init' })
  await fetchReplace<T>(store, name, init.page, 'init')
}

/**
 * Кнопка/ссылка (R7): загруженная страница → скролл к якорю без fetch;
 * незагруженная → сброс: только запрошенная страница + scroll-to-top.
 */
export async function goToPage<T>(store: Store, name: string, page: number): Promise<void> {
  const instance = getPaginator(name)
  instance.lastAction = { kind: 'goToPage', page }
  const state = getState<T>(store, name)
  // Раунд-4: скролл к якорю загруженной страницы — только в accumulate-семантике
  // (capabilities.append). В single («классика») любой переход = REPLACE, даже на
  // загруженную: иначе live-переключение режима оставляло бы стек страниц.
  if (state.loadedPages.includes(page) && instance.adapter.capabilities.append) {
    if (page !== state.page) {
      patch<T>(store, name, (s) => ({ ...s, page }))
      instance.emitter.emit({ type: 'page-changed', page, via: 'go' })
    }
    instance.scrollDriver?.({ type: 'page', page })
    safePersist(store, name)
    return
  }
  patch<T>(store, name, (s) => ({ ...s, page }))
  instance.emitter.emit({ type: 'page-changed', page, via: 'go' })
  safePersist(store, name) // R11: пагинатор отдал страницу — URL/localStorage обновляет адаптер/storage
  await fetchReplace<T>(store, name, page, 'replace')
}

/**
 * Подгрузка края коллекции (R1, R13): сентинел → APPEND страницы max+1 / min-1.
 * Пустой ответ → «ничего не делать» (R14): список цел, hasNext/hasPrev := false, append-empty.
 */
export async function loadMore<T>(store: Store, name: string, dir: 1 | -1): Promise<void> {
  const instance = getPaginator(name)
  if (!instance.adapter.capabilities.append) return
  const state = getState<T>(store, name)
  if (state.status === 'loading' || state.status === 'init') return
  if (!canLoadMore(dir, state)) return
  instance.lastAction = { kind: 'loadMore', dir }
  const target = dir > 0 ? Math.max(...state.loadedPages) + 1 : Math.min(...state.loadedPages) - 1
  const reqId = state.reqId + 1
  const lastLoaded = state.loadedPages[state.loadedPages.length - 1]
  const count = state.pages[lastLoaded]?.length ?? state.pageSize
  // D17: pending-группа создаётся НА СТАРТЕ — скелетоны-слоты (и их PageAnchor) существуют
  // с первой миллисекунды полёта; prepend-интент стреляет сразу (тайминг фидбека раунда-5).
  patch<T>(store, name, (s) => ({
    ...s,
    reqId,
    status: 'loading',
    pending: { page: target, mode: dir > 0 ? 'append' : 'prepend', count },
    error: null,
  }))
  // Интент стреляет в момент старта, до данных (D17/раунд-5). Контракт D16 как в
  // оригинале (page = подгруженная страница). UX «скролл не меняет положение»
  // (требование 2026-09-22, вариант A) реализован ХОСТОМ (holdAbove): опорный якорь —
  // бывшая первая страница (intent.page + 1), её сдвиги компенсируются в container.
  if (dir === -1) instance.scrollDriver?.({ type: 'page', page: target, reason: 'prepend' })
  let resp: PageResponse<T>
  try {
    resp = (await instance.adapter.loadPage({
      page: target,
      pageSize: state.pageSize,
      extra: state.extra,
    })) as PageResponse<T>
  } catch (error) {
    if (getState<T>(store, name).reqId !== reqId) return
    patch<T>(store, name, (s) => ({
      ...s,
      status: 'error',
      error: errMessage(error),
      pending: null,
    }))
    instance.emitter.emit({ type: 'error', error, page: target, phase: 'append' })
    notifyError(instance, 'load-failed', error, { page: target, phase: 'append' })
    return
  }
  if (getState<T>(store, name).reqId !== reqId) return // reset победил (T2.5)
  if (resp.items.length === 0) {
    patch<T>(store, name, (s) => ({
      ...s,
      status: 'idle',
      pending: null,
      hasNext: dir > 0 ? false : s.hasNext,
      hasPrev: dir < 0 ? false : s.hasPrev,
    }))
    // «Дальше нет» — тоже ответ источника: указатель обязан быть снят, иначе
    // пустой край оставил бы в адресе токен, ведущий за конец коллекции.
    mergeResponseExtra<T>(store, name, resp)
    instance.emitter.emit({ type: 'append-empty', page: target })
    return
  }
  const meta = deriveMeta(resp, state.pageSize, target)
  const nextLoaded = [...state.loadedPages, target].sort((a, b) => a - b)
  const nextPages = { ...state.pages, [target]: resp.items }
  let nextHasPrev = dir < 0 && target <= 1 ? false : state.hasPrev
  // hasNext — свойство КОНЦА коллекции: обновляется только при append вниз. После prepend
  // (dir<0) hasNext ответа относится к странице target, а не к последней загруженной —
  // иначе на последней странице после подгрузки предыдущей «воскресает» несуществующая page+1.
  const maxLoaded = nextLoaded[nextLoaded.length - 1]
  let nextHasNext =
    dir > 0
      ? (meta.hasNext ?? state.hasNext)
      : (state.hasNext ?? (meta.totalPages != null ? maxLoaded < meta.totalPages : null))
  // Опциональное скользящее окно (maxPages / DOM-eviction): защита от OOM
  if (instance.maxPages && instance.maxPages > 0 && nextLoaded.length > instance.maxPages) {
    if (dir > 0) {
      const evict = nextLoaded.shift()!
      delete nextPages[evict]
      if (nextLoaded[0] > 1) nextHasPrev = null // выше есть выгруженные страницы
    } else {
      const evict = nextLoaded.pop()!
      delete nextPages[evict]
      nextHasNext = true // ниже есть выгруженные страницы
    }
  }
  patch<T>(store, name, (s) => ({
    ...s,
    pages: nextPages,
    loadedPages: nextLoaded,
    totalItems: meta.totalItems ?? s.totalItems,
    totalPages: meta.totalPages ?? s.totalPages,
    hasNext: nextHasNext,
    hasPrev: nextHasPrev,
    status: 'idle',
    pending: null,
    error: null,
  }))
  mergeResponseExtra<T>(store, name, resp)
  instance.emitter.emit({
    type: 'loaded',
    page: target,
    itemCount: resp.items.length,
    via: 'append',
  })
  safePersist(store, name)
}

/**
 * Внешняя смена страницы (URL back/forward/ссылка через Host.externalPage, D1).
 * Эхо-guard: page === текущей → полный no-op (persist сам вызвал navigate).
 * Persist НЕ вызываем — источник изменения уже внешнее хранилище.
 */
export async function onExternalPage<T>(store: Store, name: string, page: number): Promise<void> {
  const instance = getPaginator(name)
  const state = getState<T>(store, name)
  if (page === state.page) return
  instance.lastAction = { kind: 'goToPage', page }
  if (state.loadedPages.includes(page)) {
    patch<T>(store, name, (s) => ({ ...s, page }))
    instance.emitter.emit({ type: 'page-changed', page, via: 'url' })
    instance.scrollDriver?.({ type: 'page', page })
    return
  }
  patch<T>(store, name, (s) => ({ ...s, page }))
  instance.emitter.emit({ type: 'page-changed', page, via: 'url' })
  await fetchReplace<T>(store, name, page, 'replace')
}

/** Повтор последнего действия; после ошибки init (lastAction null) — повторный init. */
export async function retry<T>(store: Store, name: string): Promise<void> {
  const instance = getPaginator(name)
  const last = instance.lastAction
  if (last?.kind === 'goToPage') {
    await goToPage<T>(store, name, last.page)
    return
  }
  if (last?.kind === 'loadMore') {
    await loadMore<T>(store, name, last.dir)
    return
  }
  patch<T>(store, name, (s) => (s.status === 'error' ? { ...s, status: 'init', error: null } : s))
  await initPaginator<T>(store, name)
}

/**
 * Раунд-7: скролл к якорю ЗАГРУЖЕННОЙ страницы — без fetch и без изменения state.
 * Потребители — любой сценарий «вернуть viewport к странице N» без семантики перехода.
 */
export function scrollToPage<T>(store: Store, name: string, page: number): void {
  const instance = getPaginator(name)
  if (!getState<T>(store, name).loadedPages.includes(page)) return
  instance.scrollDriver?.({ type: 'page', page })
}

/** Якорь сообщил текущую страницу (R3): только page + событие + persist, без fetch. */
export function reportAnchor<T>(store: Store, name: string, page: number): void {
  const instance = getPaginator(name)
  const state = getState<T>(store, name)
  if (page === state.page) return
  patch<T>(store, name, (s) => ({ ...s, page }))
  instance.emitter.emit({ type: 'page-changed', page, via: 'anchor' })
  safePersist(store, name) // R11: URL/storage следует за скроллом — на стороне адаптера
}

/**
 * SSR-хелпер лоадера: инициализировать пагинатор в свежем store и вернуть полный
 * снапшот состояния для гидрации <PaginatorHost snapshot> (R8). Идемпотентен.
 */
export async function initServerPaginator<T>(
  store: Store,
  name: string,
  ctx?: AdapterInitContext,
): Promise<PaginatorState<T>> {
  await initPaginator<T>(store, name, ctx)
  return getState<T>(store, name)
}

/**
 * Опережающая предзагрузка страницы (hover по ссылкам пагинатора).
 * Тихо загружает страницу в память, если она ещё не загружена и не в полёте.
 */
export async function prefetchPage<T>(store: Store, name: string, page: number): Promise<void> {
  const instance = getPaginator(name)
  const state = getState<T>(store, name)
  if (state.loadedPages.includes(page) || state.pending?.page === page) return
  const buffer = prefetchBuffer<T>(instance)
  if (buffer.has(page)) return
  const inflight = prefetchInflight(instance)
  if (inflight.has(page)) return
  inflight.add(page)
  const gen = (instance as PaginatorInstance & { prefetchGen?: number }).prefetchGen ?? 0
  try {
    const resp = (await instance.adapter.loadPage({
      page,
      pageSize: state.pageSize,
      extra: state.extra,
    })) as PageResponse<T>
    // Сброс в полёте (смена фильтра/размера) — ответ из другого набора, в буфер его нельзя.
    const stillCurrent =
      ((instance as PaginatorInstance & { prefetchGen?: number }).prefetchGen ?? 0) === gen
    if (stillCurrent && resp.items && resp.items.length > 0) {
      buffer.set(page, resp)
    }
  } catch {
    // тихий prefetch — не ломает UI
  } finally {
    inflight.delete(page)
  }
}

/**
 * Сброс (фидбек 2026-09-14 п.4): очистить состояние, сбросить указатель хранилища
 * (persist начального состояния → page 1) и загрузить первую страницу заново. In-flight запросы
 * отбрасываются bump'ом reqId.
 */
export async function resetPaginator<T>(store: Store, name: string): Promise<void> {
  const instance = getPaginator(name)
  if (instance.replaceAbort) {
    instance.replaceAbort.abort()
    instance.replaceAbort = null
  }
  instance.lastAction = null
  dropPrefetched(instance)
  patch<T>(store, name, (s) => ({
    ...initialState<T>(name, s.pageSize, s.extra, instance.adapter.capabilitiesFor(s.extra)),
    reqId: s.reqId + 1,
  }))
  safePersist(store, name) // storage/URL ← исходный указатель (page 1)
  await initPaginator<T>(store, name) // status 'init' → свежая загрузка страницы 1
}

/**
 * Смена размера страницы. Накопленные страницы под старую нарезку невалидны → сброс и
 * REPLACE-загрузка страницы, на которой лежит первый элемент текущей страницы
 * (пользователь остаётся «на том же месте» списка). pageSize/extra попадают в хранилище
 * через обычный persist после загрузки.
 */
export async function setPageSize<T>(store: Store, name: string, pageSize: number): Promise<void> {
  if (!Number.isInteger(pageSize) || pageSize < 1) return
  const instance = getPaginator(name)
  const state = getState<T>(store, name)
  if (state.pageSize === pageSize) return
  const firstIndex = (state.page - 1) * state.pageSize
  const page = Math.floor(firstIndex / pageSize) + 1
  if (instance.replaceAbort) {
    instance.replaceAbort.abort()
    instance.replaceAbort = null
  }
  instance.lastAction = { kind: 'goToPage', page }
  dropPrefetched(instance)
  patch<T>(store, name, (s) => ({
    ...initialState<T>(name, pageSize, s.extra, instance.adapter.capabilitiesFor(s.extra)),
    page,
    status: 'idle',
    reqId: s.reqId + 1,
  }))
  instance.emitter.emit({ type: 'page-changed', page, via: 'go' })
  safePersist(store, name) // URL/storage ← новый pageSize (+ пересчитанная страница)
  await fetchReplace<T>(store, name, page, 'replace')
}

/**
 * Позиционные ключи (см. `positionKeys` в конфиге) переживают сброс окна только в одном
 * случае: их прислал сам патч. Иначе их снимает ядро — ключ вида «указатель следующего
 * шага» описывает место в ПРОШЛОМ окне, а источник, получив его вместе с новым
 * порядком, обязан отказать (иначе он выдал бы чужую середину выдачи). Демо БД на этом
 * и спотыкалось: смена сортировки на 1-й странице курсорного режима уезжала в 400.
 */
function dropPositionKeys(
  extra: Extra,
  positionKeys: Set<string>,
  patch: Record<string, ExtraValue | undefined>,
): Extra {
  if (positionKeys.size === 0) return extra
  let next: Extra | null = null
  for (const key of positionKeys) {
    if (!(key in extra) || key in patch) continue
    next ??= { ...extra }
    delete next[key]
  }
  return next ?? extra
}

/**
 * Ключи потребителя (см. RestorableState.extra): патч + persist, без загрузки.
 * `reload: true` — ключ влияет на данные источника (фильтр/вид контента) → сброс и
 * загрузка страницы 1 с новым extra.
 */
export async function setExtra<T>(
  store: Store,
  name: string,
  patchExtra: Record<string, ExtraValue | undefined>,
  options: { reload?: boolean } = {},
): Promise<void> {
  const instance = getPaginator(name)
  const state = getState<T>(store, name)
  assertDeclaredExtraKeys(instance, patchExtra)
  let changed = false
  let touchesData = false
  for (const [k, v] of Object.entries(patchExtra)) {
    // `undefined` = УДАЛИТЬ ключ (снятие фильтра). Раньше сравнение пропускало
    // такой патч, и стор хранил значение вечно: список оставался суженным.
    const removed = v === undefined && k in state.extra
    if (removed || (v !== undefined && state.extra[k] !== v)) {
      changed = true
      if (instance.reloadKeys.has(k)) touchesData = true
    }
  }
  if (!changed) return
  // Ключ вычищается целиком: `{ ...extra, k: undefined }` оставил бы «ключ есть,
  // значение undefined», и persist со сравнениями ловили бы фантом.
  const mergeExtra = (extra: Extra): Extra => {
    const next: Extra = { ...extra }
    for (const [k, v] of Object.entries(patchExtra)) {
      if (v === undefined) delete next[k]
      else next[k] = v
    }
    return next
  }
  if (options.reload ?? touchesData) {
    if (instance.replaceAbort) {
      instance.replaceAbort.abort()
      instance.replaceAbort = null
    }
    instance.lastAction = { kind: 'goToPage', page: 1 }
    dropPrefetched(instance)
    patch<T>(store, name, (s) => {
      const extra = dropPositionKeys(mergeExtra(s.extra), instance.positionKeys, patchExtra)
      return {
        ...initialState<T>(name, s.pageSize, extra, instance.adapter.capabilitiesFor(extra)),
        status: 'idle',
        reqId: s.reqId + 1,
      }
    })
    instance.emitter.emit({ type: 'page-changed', page: 1, via: 'go' })
    safePersist(store, name)
    await fetchReplace<T>(store, name, 1, 'replace')
    return
  }
  patch<T>(store, name, (s) => {
    const extra = mergeExtra(s.extra)
    return { ...s, extra, capabilities: instance.adapter.capabilitiesFor(extra) }
  })
  safePersist(store, name)
}

/**
 * Запись неподдерживаемого ключа — ошибка разработчика, а не «тихо ничего не
 * произошло»: ключ обязан быть объявлен либо ИСТОЧНИКОМ (`source.extraKeys()`),
 * либо ПОТРЕБИТЕЛЕМ (спецификация адреса / объявленные ключи). Снятие ключа
 * (`undefined`) и пустое значение легальны всегда: это очистка, а не установка.
 */
function assertDeclaredExtraKeys(
  instance: PaginatorInstance,
  patch: Record<string, ExtraValue | undefined>,
): void {
  const declared = instance.adapter.extraKeys?.()
  if (!declared) return // поверхность потребителя не объявлена — судить нечем
  const known = new Set(declared)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === '') continue
    if (!known.has(key)) {
      const own = [...known].sort().join(', ')
      throw new Error(
        `setExtra("${instance.name}"): ключ «${key}» не объявлен ни источником, ни потребителем. ` +
          `Объявленные ключи: ${own || '—'}.`,
      )
    }
  }
}
