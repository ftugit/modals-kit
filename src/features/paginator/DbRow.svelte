<script lang="ts">
  /**
   * Строка записи из БД в демо-пагинаторе: compact-форма той же записи, которую
   * `/db-demo` рисует шире (там нужен полный id для формы удаления).
   *
   * Отдельная вьюха — это не «ещё один список»: данные приезжают из одного
   * источника (`$lib/ui/demo/db-list`), режим курсора и режим страниц работают
   * здесь точно так же, как на странице БД, потому что решает источник.
   */
  import { catalogTestId } from './item-views'
  import type { DbPost } from '$lib/ui/demo/db-list/definition'

  interface Props {
    item: DbPost
  }

  let { item }: Props = $props()
</script>

<div
  data-testid={catalogTestId(item)}
  class="flex h-11 items-center gap-3 rounded-lg border border-border bg-card px-3 text-sm shadow-xs"
>
  <span class="min-w-0 flex-1 truncate">{item.title}</span>
  <span class="text-xs text-muted-foreground">{item.created_at}</span>
  <code class="text-xs text-muted-foreground">{item.id.slice(0, 8)}</code>
</div>
