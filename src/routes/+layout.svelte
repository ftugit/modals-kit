<script lang="ts">
  // Корневой layout — общее для ВСЕХ маршрутов: <head>, контекст страницы,
  // стили и фатальная ошибка. Структура папками (C2), без проверок route.id:
  //   (site)/            — каркас сайта (шапка, сайдбар);
  //     (app)/           — страницы с глобальной модальной системой;
  //     (modals-demo)/   — /modals со своей областью и носителями;
  //   cycle/, spike/     — вне каркаса, со своими модальными системами.
  import favicon from '#lib/assets/favicon.svg'
  import { appErrors } from '#hooks/app-errors.svelte.js'
  import Error500 from '#components/Error500.svelte'
  import { LoaderBar } from '#components/loader/index.js'
  import { setPageContext, PageHead } from '#components/shell/index.js'
  import 'virtual:uno.css'
  import '../app.css'

  let { children } = $props()

  // Базовые SEO-метаданные сайта; конкретные страницы накладывают свой слой через `useHeadSeo`.
  setPageContext({
    title: 'modals-kit',
    titleSeparator: ' — ',
    siteName: 'modals-kit',
    locale: 'ru_RU',
    type: 'website',
    card: 'summary',
  })
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<LoaderBar />

{#if appErrors.critical}
  <!-- фатал заменяет всё целиком: ориентир main — здесь -->
  <main><Error500 /></main>
{:else}
  {@render children()}
{/if}

<!-- В SSR Svelte исполняет соседей сверху вниз: PageHead стоит ПОСЛЕ children/Error500,
     чтобы синхронный `useHeadSeo(...)` дочернего маршрута уже лежал в `PageState` к моменту записи `<head>`. -->
<PageHead defaultTitle="modals-kit" />
