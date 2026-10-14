<script lang="ts">
  import { asLink } from '#lib/components/links/index.js'
  // Содержимое страницы ошибок SvelteKit — общее для двух границ (C2):
  // `routes/(site)/+error.svelte` (внутри каркаса, его `<main>`) и корневой
  // `routes/+error.svelte` (/cycle, /spike и сбой самого каркаса — `<main>`
  // ставит он). Серверные краши (в т.ч. фатал из `report`, брошенный в
  // SSR-пути) приходят сюда. 5xx — та же разметка, что и клиентский оверлей;
  // 4xx — нейтральный текст. Стек и причина клиенту не показываются никогда.
  import { page } from '$app/state'
  import Error500 from '#lib/components/Error500.svelte'

  const serverError = $derived(page.status >= 500)
</script>

{#if serverError}
  <Error500 />
{:else}
  <!-- Не <main>: ориентир даёт место вызова — каркас или корневая граница (B4). -->
  <div class="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
    <!-- role="alert" — на содержимом: анонс при клиентском переходе на ошибку -->
    <div class="flex max-w-md flex-col items-center gap-3 text-center" role="alert">
      <span class="text-5xl font-black tracking-tight text-muted-foreground">{page.status}</span>
      <h1 class="text-lg font-semibold">Страница не найдена или недоступна</h1>
      <a {...asLink('/')} class="text-sm text-primary underline">На главную</a>
    </div>
  </div>
{/if}
