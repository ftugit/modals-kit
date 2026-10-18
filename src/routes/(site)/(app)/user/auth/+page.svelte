<script lang="ts">
  // Страница авторизации: тот же виджет, что и в модалке (UserMenu открывает
  // модалку с JS, а ссылка без JS ведёт сюда — один компонент, два носителя).
  import AuthWidget from '#content/user/ui/AuthWidget.svelte'
  import type { PageProps } from './$types'

  let { data, form }: PageProps = $props()
</script>

<svelte:head><title>Авторизация</title></svelte:head>

<div class="mx-auto max-w-xl px-4 py-10">
  <h1 class="mb-6 text-xl font-semibold">Вход</h1>
  <AuthWidget {data} form={form as { result?: import('#lib/form/index.js').Result } | null} mode="page" />
</div>
