<script lang="ts">
  // Страница авторизации: тот же виджет, что и в модалке (UserMenu открывает
  // модалку с JS, а ссылка без JS ведёт сюда — один компонент, два носителя).
  import AuthWidget from '#content/user/ui/AuthWidget.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()
</script>

<svelte:head><title>Авторизация</title></svelte:head>

<div class="mx-auto w-full max-w-sm">
  <h1 class="mb-4 text-xl font-semibold">Вход</h1>
  <AuthWidget {data} mode="page" variant="card" />
</div>
