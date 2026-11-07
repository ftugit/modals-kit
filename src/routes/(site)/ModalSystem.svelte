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
  import { createScopeBarrier } from './scope-barrier.js'
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
  import { useIsMobile } from '#hooks/mobile.svelte.js'
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
  const narrow = useIsMobile()

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
  const kitPreload = core.preload
  const scopeBarrier = createScopeBarrier({
    initial: untrack(() => cacheScope),
    current: () => cacheScope,
    waitAddress: whenAddressSettled,
    refresh: refreshAll,
    matches: (next) => page.status < 400 && page.data.user !== undefined &&
      ((page.data.user as { sub?: string } | null | undefined)?.sub ?? null) === (next ?? null),
    invalidate: () => modals.invalidateLoader(undefined, undefined, { hard: true }),
  })
  if (kitPreload) core.preload = (href) => scopeBarrier.run(() => kitPreload(href))

  $effect(() => {
    const next = cacheScope
    untrack(() => scopeBarrier.change(next))
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
  isNarrow={narrow.matches}
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
