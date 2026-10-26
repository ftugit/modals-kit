<script lang="ts">
  /**
   * Профиль в модалке (`?modal=user.profile&id=…`). Своего `loader` у модалки
   * нет: данные приносит `load` маршрута `/user/[id]` — тот же, что у страницы,
   * его исполняет `preloadData` по `route` модалки. Пока данные летят, компонент
   * не смонтирован: скелетон рисует ядро модалок (`hasLoader` учитывает `route`).
   *
   * Экран тот же, что на странице (`ProfileScreen`), поэтому и отказ прав
   * выглядит одинаково в обоих носителях.
   */
  import { useLoader } from '#lib/modals/svelte/index.js'
  import ProfileScreen from './ProfileScreen.svelte'
  import type { ProfileScreenData } from '../types.js'

  const ldr = useLoader<ProfileScreenData>()
</script>

{#if ldr.data}
  <ProfileScreen {...ldr.data} class="p-5" />
{/if}
