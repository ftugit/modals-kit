<script lang="ts">
  import { asLink } from '#hooks/links/index.js'
  // Содержимое страницы ошибок SvelteKit — общее для двух границ (C2):
  // `routes/(site)/+error.svelte` (внутри каркаса, его `<main>`) и корневой
  // `routes/+error.svelte` (/cycle, /spike и сбой самого каркаса — `<main>`
  // ставит он). Серверные краши (в т.ч. фатал из `report`, брошенный в
  // SSR-пути) приходят сюда. 5xx — та же разметка, что и клиентский оверлей;
  // 4xx — нейтральный текст. Стек и причина клиенту не показываются никогда.
  import { page } from '$app/state'
  import Error500 from '#components/Error500.svelte'
  import { useHeadSeo } from '#components/shell/page.svelte.js'
  import { isSchemaPending, schemaHref } from '#hooks/schema-route.js'

  const serverError = $derived(page.status >= 500)
  // `schema_pending` — не сбой приложения, а известное состояние: база отстала от
  // моделей, и её переносит человек под секретом. Без этой ссылки страница ошибок
  // была бы тупиком на каждом разделе с БД.
  const schemaPending = $derived(isSchemaPending((page.error as { code?: string } | null)?.code))
  // Без `?next=`: граница ошибок не читает адрес — после переноса человек
  // вернётся сам, а `/schema` остаётся единственной точкой входа.
  const schemaLink = schemaHref()

  useHeadSeo(
    () => ({
      subTitle: schemaPending
        ? 'Требуется обновление схемы базы'
        : serverError
          ? 'Приложение недоступно'
          : page.status === 404
            ? 'Страница не найдена'
            : `Ошибка ${page.status}`,
      description: schemaPending
        ? 'База данных ожидает применения миграций схемы.'
        : serverError
          ? 'Произошла внутренняя ошибка приложения.'
          : 'Запрошенная страница не найдена или недоступна.',
      noindex: true,
    }),
    { optional: true },
  )
</script>

{#if schemaPending}
  <!-- Не <main>: ориентир даёт место вызова — каркас или корневая граница (B4). -->
  <div class="grid min-h-full place-items-center bg-background px-6 py-12 text-foreground">
    <div class="flex max-w-md flex-col items-center gap-3 text-center" role="alert">
      <span class="text-5xl font-black tracking-tight text-muted-foreground">503</span>
      <h1 class="text-lg font-semibold">Требуется обновление схемы базы</h1>
      <a {...asLink(schemaLink)} class="text-sm text-primary underline">Открыть перенос схемы</a>
    </div>
  </div>
{:else if serverError}
  <Error500 />
{:else}
  <!-- Не <main>: ориентир даёт место вызова — каркас или корневая граница (B4). -->
  <div class="grid min-h-full place-items-center bg-background px-6 py-12 text-foreground">
    <!-- role="alert" — на содержимом: анонс при клиентском переходе на ошибку -->
    <div class="flex max-w-md flex-col items-center gap-3 text-center" role="alert">
      <span class="text-5xl font-black tracking-tight text-muted-foreground">{page.status}</span>
      <h1 class="text-lg font-semibold">Страница не найдена или недоступна</h1>
      <a {...asLink('/')} class="text-sm text-primary underline">На главную</a>
    </div>
  </div>
{/if}
