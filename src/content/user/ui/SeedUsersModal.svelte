<script lang="ts">
  /**
   * Список seed-юзеров в модалке (`?modal=user.list`). Своего `loader` у
   * модалки нет: данные приносит `load` маршрута `/users` — тот же, что у
   * страницы, его исполняет `preloadData` по `route` модалки. Пока данные
   * летят, компонент не смонтирован: скелетон рисует ядро модалок.
   *
   * Экран тот же, что на странице (`SeedUsersScreen`), поэтому и отказ прав
   * выглядит одинаково в обоих носителях.
   */
  import { untrack } from 'svelte'
  import { useLoader, useModals } from '#lib/modals/svelte/index.js'
  import { vault } from '../vault.svelte.js'
  import type { AuthErrorCode } from '../error.js'
  import SeedUsersScreen from './SeedUsersScreen.svelte'
  import type { SeedUsersScreenData } from './seed-users/source.js'

  const m = useModals()
  const ldr = useLoader<SeedUsersScreenData>()

  // Loader-кеш модалки переживает закрытие, поэтому снимок с отказом сессии
  // (`fact`) мог остаться и после входа: плашка `Acl` не пропадала ни при
  // возврате из auth-модалки, ни при переоткрытии списка. Если клиент уже
  // авторизован, а снимок говорит «сессии нет», снимок заведомо устарел —
  // сбрасываем кеш своей записи: при следующей активации (возврат из
  // auth-модалки, переоткрытие) хост перезапустит loader по живой сессии.
  const SESSION_FACTS: ReadonlySet<AuthErrorCode> = new Set([
    'auth.expired',
    'auth.revoked',
    'auth.session-unknown',
  ])
  let cacheDroppedFor = ''
  $effect(() => {
    const fact = ldr.data?.fact
    if (!fact || !SESSION_FACTS.has(fact) || !vault.authorized) return
    const key = `${fact}:${vault.principal ?? ''}`
    if (cacheDroppedFor === key) return
    cacheDroppedFor = key
    untrack(() => m.modals.invalidateLoader('user.list'))
  })
</script>

{#if ldr.data}
  <SeedUsersScreen {...ldr.data} class="p-5" />
{/if}
