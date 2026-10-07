<script lang="ts">
  import { animeTitle, type AnimeCard } from '../../content/shikimori'

  interface Props {
    item: AnimeCard
  }

  let { item }: Props = $props()
</script>

<!--
  Плитка колонок: постер + подпись (как `ShotTile` у фото), но с сохранением
  пропорций картинки — сетка колонок сама считает высоту ряда.
-->
<figure data-testid={`anime-${item.id}`} class="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
  {#if item.poster}
    <img src={item.poster} alt="" loading="lazy" class="aspect-[2/3] w-full object-cover" />
  {:else}
    <div class="aspect-[2/3] w-full bg-muted"></div>
  {/if}
  <figcaption class="p-2">
    <span class="block truncate text-xs font-medium">{animeTitle(item)}</span>
    <span class="block truncate text-[11px] text-muted-foreground">
      {item.year ?? '—'}{item.score ? ` · ★ ${item.score.toFixed(1)}` : ''}
    </span>
  </figcaption>
</figure>
