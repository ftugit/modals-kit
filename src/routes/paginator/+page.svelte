<script lang="ts">
  import type { PageData } from './$types'
  import PaginatorDemo from '../../features/paginator/PaginatorDemo.svelte'

  interface Props {
    data: PageData
  }

  let { data }: Props = $props()
</script>

<svelte:head>
  <title>Пагинатор — modals-kit</title>
  <meta
    name="description"
    content="Headless-пагинация: указатель и настройки в GET (?page, ?page.size, ?page.<key>), SSR-снапшот из лоадера, накопление страниц со скролл-сентинелами и якорями."
  />
</svelte:head>

<PaginatorDemo loaderData={data.loaderData} />
