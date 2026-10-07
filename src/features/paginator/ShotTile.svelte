<script lang="ts">
  import type { AnimeCard } from '../../content/shikimori'
  import {
    catalogTestId,
    catalogTitle,
    isPhotoItem,
    shotHeight,
    SHOT_COLORS,
    type CatalogItem,
  } from './item-views'

  interface Props {
    /** Плитка обслуживает товары и фото; у каталога Shikimori своя (`AnimeTile`). */
    item: Exclude<CatalogItem, AnimeCard>
    prefix?: string
  }

  let { item, prefix }: Props = $props()

  const height = $derived(isPhotoItem(item) ? shotHeight(item.id) : 120)
  const caption = $derived(`${catalogTitle(item)} · #${item.id}`)
  const colorClass = $derived(SHOT_COLORS[item.id % SHOT_COLORS.length])
</script>

<figure
  data-testid={catalogTestId(item, prefix)}
  style={`height: ${height}px;`}
  class={`flex items-end rounded-lg p-2 ${colorClass}`}
>
  <figcaption class="truncate text-xs text-foreground">{caption}</figcaption>
</figure>
