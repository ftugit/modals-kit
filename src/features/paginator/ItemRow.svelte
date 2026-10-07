<script lang="ts">
  import { catalogTestId, catalogTitle, isProductItem, type CatalogItem } from './item-views'

  interface Props {
    item: CatalogItem
  }

  let { item }: Props = $props()

  const label = $derived(catalogTitle(item))
  const tail = $derived(isProductItem(item) ? `${item.price} ₽` : `#${item.id}`)
</script>

<div
  data-testid={catalogTestId(item)}
  class="flex h-11 items-center rounded-lg border border-border bg-card px-3 text-sm shadow-xs"
>
  <span>{label}</span>
  <span class="ml-auto text-xs text-muted-foreground">{tail}</span>
</div>
