<script lang="ts">
  /**
   * Список демо — обычный потребитель `$lib/paginate`: строки рисует
   * `PageList`, навигацию и состояние — компоненты `$lib/ui/paginator`.
   * Своего `slice`, своих ссылок «дальше» и своего чтения адреса здесь нет:
   * адрес принадлежит пагинатору (`?db`, `?db.size`, `?db.flt`, `?db.ord`).
   */
  import { PaginatorHost } from '$lib/paginate/svelte'
  import type { PaginatorState } from '$lib/paginate'
  import { EmptyState, ErrorRow, LoadingIndicator, PageList, PageNav } from '$lib/ui/paginator'
  import type { DbPost } from './definition'

  interface Props {
    name: string
    /** SSR-снапшот из лоадера: без JavaScript список виден целиком. */
    snapshot?: PaginatorState<DbPost> | null
    /** Первая строка как пришла из слоя — технический блок демо. */
    raw?: string
  }

  let { name, snapshot = null, raw = '' }: Props = $props()
</script>

<PaginatorHost {name} {snapshot} mode="single" class="space-y-3">
  <LoadingIndicator {name} text="Загружаю страницу…" />
  <ErrorRow {name} />

  <div class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" data-testid="rows">
    <div class="flex items-baseline gap-3 px-4 py-2 text-xs text-muted-foreground">
      <span class="min-w-0 flex-1">title</span>
      <span>created_at</span>
      <span>id — скопируйте в поле удаления</span>
    </div>
    <PageList {name}>
      {#snippet renderItem(item: DbPost)}
        <div class="flex items-baseline gap-3 px-4 py-2" data-testid="row">
          <span class="min-w-0 flex-1 truncate">{item.title}</span>
          <span class="text-xs text-muted-foreground">{item.created_at}</span>
          <code class="text-xs text-muted-foreground" data-testid="row-id">{item.id}</code>
        </div>
      {/snippet}
    </PageList>
    <EmptyState {name}>
      <p class="px-4 py-6 text-center text-sm text-muted-foreground">записей нет — добавьте первую формой слева</p>
    </EmptyState>
  </div>

  <PageNav {name} counter class="flex items-center gap-2 text-sm" />

  {#if raw}
    <pre class="overflow-auto rounded-lg bg-muted p-3 text-xs" data-testid="raw">{raw}</pre>
  {/if}
</PaginatorHost>
