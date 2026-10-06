<script lang="ts">
  import type { DemoItem } from '../../content/items'
  import { isPhotoItem, shotHeight, SHOT_COLORS } from './item-views'

  interface Props {
    item: DemoItem
    prefix?: string
  }

  let { item, prefix }: Props = $props()

  const isPhoto = $derived(isPhotoItem(item))
  const height = $derived(isPhoto ? shotHeight(item.id) : 120)
  const caption = $derived(
    isPhoto ? `Photo ${item.id} · #${item.id}` : `${(item as any).title} · #${item.id}`
  )
  const tid = $derived(
    `${prefix ? `${prefix}-` : ''}${isPhoto ? 'photo' : 'card'}-${item.id}`
  )
  const colorClass = $derived(SHOT_COLORS[item.id % SHOT_COLORS.length])
</script>

<figure
  data-testid={tid}
  style={`height: ${height}px;`}
  class={`flex items-end rounded-lg p-2 ${colorClass}`}
>
  <figcaption class="truncate text-xs text-foreground">{caption}</figcaption>
</figure>
