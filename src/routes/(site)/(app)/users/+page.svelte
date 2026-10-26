<script lang="ts">
  // Страница списка seed-юзеров: тот же экран, что и модалка `user.list`.
  // Данные даёт `load` этого маршрута; модалка исполняет ровно его же через
  // `preloadData`.
  import SeedUsersScreen from '#content/user/ui/SeedUsersScreen.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Seed-юзеры</title></svelte:head>

<div class="mx-auto w-full max-w-2xl">
  <SeedUsersScreen {...data} />
</div>
