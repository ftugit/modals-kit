// Действия ядра пагинатора над Store (SPEC §3.3). Vanilla: сервер (loader) + клиент.
// Дословный порт core.ts React-версии: jotai-store → Store из store.ts, логика 1-в-1
// (reqId-гонки, эхо-guard, pending-скелетоны, события, persist).
import { canLoadMore, deriveMeta, flattenPages } from './pure'
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

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** persist не критичен для отображения: ошибка → warn, состояние не ломается (SPEC §3.3). */
export function safePersist(store: Store, name: string): void {
  const instance = getPaginator(name)
  try {
    const result = instance.adapter.persist(getState<unknown>(store, name))
    if (result instanceof Promise) {
      result.catch((error) => console.warn('[paginate] persist failed:', error))
    }
  } catch (error) {
    console.warn('[paginate] persist failed:', error)
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
  const holder = instance as PaginatorInstance & { prefetched?: Map<number, unknown> }
  holder.prefetched?.clear()
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
  try {
    const resp = (await instance.adapter.loadPage({
      page,
      pageSize: state.pageSize,
      extra: state.extra,
    })) as PageResponse<T>
    if (resp.items && resp.items.length > 0) {
      buffer.set(page, resp)
    }
  } catch {
    // тихий prefetch — не ломает UI
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
    ...initialState<T>(name, s.pageSize, s.extra),
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
    ...initialState<T>(name, pageSize, s.extra),
    page,
    status: 'idle',
    reqId: s.reqId + 1,
  }))
  instance.emitter.emit({ type: 'page-changed', page, via: 'go' })
  safePersist(store, name) // URL/storage ← новый pageSize (+ пересчитанная страница)
  await fetchReplace<T>(store, name, page, 'replace')
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
    patch<T>(store, name, (s) => ({
      ...initialState<T>(name, s.pageSize, mergeExtra(s.extra)),
      status: 'idle',
      reqId: s.reqId + 1,
    }))
    instance.emitter.emit({ type: 'page-changed', page: 1, via: 'go' })
    safePersist(store, name)
    await fetchReplace<T>(store, name, 1, 'replace')
    return
  }
  patch<T>(store, name, (s) => ({ ...s, extra: mergeExtra(s.extra) }))
  safePersist(store, name)
}
