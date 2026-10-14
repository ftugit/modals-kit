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
  import { report } from '#lib/app-errors.svelte.js'
  import { ModalHost } from '#lib/modals/svelte/index.js'
  import { BackdropCloseIcon, ModalError, Skeleton } from '#lib/components/modals/index.js'

  interface Props {
    /** Область модалок ветки: постоянна для экземпляра (ветку задаёт папка). */
    scope: ModalRegistry
    /** Имена носителей цепочки (`url`, `local`, `memory`); геттер — может меняться. */
    sources: () => readonly string[]
    children: Snippet
  }
  let { scope, sources, children }: Props = $props()

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
    configScope: () => page.url.pathname,
  })

  $effect(() => {
    // Скоуп настроек — данные в сторе (см. комментарий `scopedConfig`):
    // раскладка сообщает путь, геттеры хоста остаются чистыми.
    modals.setScope(page.url.pathname)
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
