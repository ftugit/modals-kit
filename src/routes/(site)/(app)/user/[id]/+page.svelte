<script lang="ts">
  // Страница профиля: тот же экран, что и модалка `user.profile`. Данные даёт
  // `load` этого маршрута; модалка исполняет ровно его же через `preloadData`.
  import ProfileScreen from '#content/user/ui/ProfileScreen.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Профиль</title></svelte:head>

<div class="mx-auto w-full max-w-sm">
  <ProfileScreen {...data} />
</div>
