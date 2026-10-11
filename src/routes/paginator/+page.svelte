<script lang="ts">
  import type { PageProps } from './$types'
  import PaginatorDemo from '#lib/ui/demo/paginator/PaginatorDemo.svelte'

  let { data }: PageProps = $props()
</script>

<svelte:head>
  <title>Пагинатор — modals-kit</title>
  <meta
    name="description"
    content="Headless-пагинация: указатель и настройки в GET (?page, ?page.size, ?page.<key>), SSR-снапшот из лоадера, накопление страниц со скролл-сентинелами и якорями."
  />
</svelte:head>

<PaginatorDemo loaderData={data.loaderData} />
