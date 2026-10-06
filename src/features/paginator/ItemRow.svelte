<script lang="ts">
  import type { DemoItem } from '../../content/items'
  import { isPhotoItem } from './item-views'

  interface Props {
    item: DemoItem
  }

  let { item }: Props = $props()

  const isPhoto = $derived(isPhotoItem(item))
  const label = $derived(isPhoto ? `Photo ${item.id}` : (item as any).title)
  const tid = $derived(isPhoto ? `photo-${item.id}` : `card-${item.id}`)
</script>

<div
  data-testid={tid}
  class="flex h-11 items-center rounded-lg border border-border bg-card px-3 text-sm shadow-xs"
>
  <span>{label}</span>
  <span class="ml-auto text-xs text-muted-foreground">#{item.id}</span>
</div>
