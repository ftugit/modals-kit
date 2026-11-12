<script lang="ts">
  import type { PageProps } from './$types'
  import { useHeadSeo } from '#components/shell/index.js'
  import { PaginatorScope } from '#lib/paginate/svelte/index.js'
  import { DB_LIST_NAME, ensureDbListPaginator } from '#content/demo-catalog/posts/source.js'
  import DbDemoBody from './DbDemoBody.svelte'

  let { data }: PageProps = $props()
  ensureDbListPaginator()

  useHeadSeo({
    subTitle: 'База данных',
    description:
      'Слой #lib/db внутри SvelteKit: миграции, ресурсы с политиками прав, формы, пагинация и курсоры на PGlite и PostgreSQL.',
  })
</script>

<PaginatorScope snapshots={{ [DB_LIST_NAME]: data.snapshot }}>
  <DbDemoBody {data} />
</PaginatorScope>
