<script lang="ts">
  // Модальная система ветки сайта: ядро SvelteKit + хост с оформлением сайта.
  // Ветки различаются только областью модалок и носителями (C2): `(app)` —
  // globalScope и базовая пара url+local, `(modals-demo)` — demoScope и
  // носители, которые переключает панель демо. Решает ПАПКА маршрута, а не
  // проверка `route.id` в коде; при переходе между ветками хост пересоздаётся,
  // каркас `(site)` над ним — нет.
  //
  // Лежит рядом с маршрутами, а не в lib: ему нужен `$app/state`, а lib
  // импортирует `$app/*` только в слоях фреймворка ядер.
  import { visibleAddress, whenAddressSettled } from '#lib/address/sveltekit.js'
  import { refreshAll } from '$app/navigation'
  import { untrack, type Snippet } from 'svelte'
  import { page } from '$app/state'
  import {
    createModals,
    localStorageChain,
    memoryStorage,
    urlStorage,
    type ChainStorage,
    type ModalRegistry,
  } from '#lib/modals/index.js'
  import { svelteKitCore } from '#lib/modals/cores/sveltekit.js'
  import { report } from '#hooks/app-errors.svelte.js'
  import { ModalHost } from '#lib/modals/svelte/index.js'
  import { BackdropCloseIcon, ModalError, Skeleton } from '#components/modals/index.js'

  interface Props {
    /** Область модалок ветки: постоянна для экземпляра (ветку задаёт папка). */
    scope: ModalRegistry
    /** Имена носителей цепочки (`url`, `local`, `memory`); геттер — может меняться. */
    sources: () => readonly string[]
    /** Чужие имена при нескольких хостах: 'skip' — их рисует хост, чьё имя. */
    foreignNames?: 'error' | 'skip'
    cacheScope?: string | null
    children: Snippet
  }
  let { scope, sources, foreignNames, cacheScope, children }: Props = $props()

  /** Набор источников под выбранные имена. */
  function sourcesFor(names: readonly string[]): Record<string, ChainStorage> {
    const map: Record<string, ChainStorage> = {}
    if (names.includes('url')) map.url = urlStorage()
    if (names.includes('local')) {
      map.local = localStorageChain(
        typeof localStorage !== 'undefined'
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      )
    }
    if (names.includes('memory')) map.memory = memoryStorage()
    return map
  }

  const initial = untrack(() => ({ names: [...sources()], lookup: scope.lookup }))
  const core = svelteKitCore(sourcesFor(initial.names), { lookup: initial.lookup })
  // `configScope` — адрес страницы как ключ слайса настроек: `m.modals.configure`
  // демки пишет только в свой слайс, база (пропсы хоста) общая для всех.
  const modals = createModals(core, {
    tailCount: 3,
    maxHeight: '80vh',
    onError: report,
    configScope: () => visibleAddress().url.pathname,
  })

  // Кеш preloadData принадлежит SvelteKit, а не загрузчику модалок. При
  // смене сессии сначала скрываем данные, затем ждём refreshAll (он сбрасывает
  // и этот кеш), и только после этого разрешаем новую загрузку маршрута.
  let appliedCacheScope = untrack(() => cacheScope)
  let scopeEpoch = 0
  let scopeBarrier: Promise<void> = Promise.resolve()
  const kitPreload = core.preload
  function changeCacheScope(next: string | null | undefined) {
    if (next === appliedCacheScope) return
    appliedCacheScope = next
    const epoch = ++scopeEpoch
    scopeBarrier = Promise.resolve().then(async () => {
      await whenAddressSettled()
      if (epoch !== scopeEpoch) return
      await refreshAll()
      if (epoch !== scopeEpoch) return
      const serverPrincipal = (page.data.user as { sub?: string } | null | undefined)?.sub ?? null
      if (page.status >= 400 || serverPrincipal !== (next ?? null)) {
        throw new Error('Session refresh did not settle')
      }
    })
    // Барьер установлен до уведомления загрузчика, чтобы синхронный подписчик
    // тоже не мог прочитать старый кеш SvelteKit.
    modals.invalidateLoader(undefined, undefined, { hard: true })
    // Обработчик предотвращает unhandled rejection, не превращая ошибку в успех.
    void scopeBarrier.catch(() => {})
  }
  if (kitPreload) core.preload = async (href) => {
    changeCacheScope(cacheScope)
    const epoch = scopeEpoch
    await scopeBarrier
    if (epoch !== scopeEpoch || cacheScope !== appliedCacheScope) {
      throw new Error('Session changed during modal preload')
    }
    const result = await kitPreload(href)
    if (epoch !== scopeEpoch || cacheScope !== appliedCacheScope) {
      throw new Error('Session changed during modal preload')
    }
    return result
  }

  $effect(() => {
    const next = cacheScope
    untrack(() => changeCacheScope(next))
  })

  $effect(() => {
    // Скоуп настроек — данные в сторе (см. комментарий `scopedConfig`):
    // раскладка сообщает путь, геттеры хоста остаются чистыми.
    modals.setScope(visibleAddress().url.pathname)
  })

  // Носители меняет панель демо (`demoSources`): ядро перенастраивается без
  // пересоздания — открытые окна и история остаются.
  let appliedNames = initial.names.join()
  $effect(() => {
    const names = [...sources()]
    const key = names.join()
    if (key === appliedNames) return
    appliedNames = key
    untrack(() => core.reconfigure({ sources: sourcesFor(names), lookup: initial.lookup }))
  })
</script>

<ModalHost
  {modals}
  onError={report}
  {scope}
  {foreignNames}
  closeIcon
  backdropClick="top"
  tailCount={3}
  maxHeight="80vh"
  mobileBreakpoint={768}
  defaultMobile="bottom"
>
  {#snippet skeleton()}
    <Skeleton />
  {/snippet}
  {#snippet error(message, hint)}
    <ModalError {message} {hint} />
  {/snippet}
  {#snippet closeIconSlot()}
    <BackdropCloseIcon />
  {/snippet}

  {@render children()}
</ModalHost>
