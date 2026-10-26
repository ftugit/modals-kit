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
  import { useLoader } from '#lib/modals/svelte/index.js'
  import SeedUsersScreen from './SeedUsersScreen.svelte'
  import type { SeedUsersScreenData } from './seed-users/source.js'

  const ldr = useLoader<SeedUsersScreenData>()
</script>

{#if ldr.data}
  <SeedUsersScreen {...ldr.data} class="p-5" />
{/if}
