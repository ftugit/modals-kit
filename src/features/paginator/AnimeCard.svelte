<script lang="ts">
  // Карточка тайтла Shikimori: постер, тип/серии, название и синонимы.
  // Ссылка ведёт на Shikimori (карточка-модалка в порт не входила: раздел
  // демонстрирует пагинатор + lib search, а не модальный слой).
  import type { AnimeRecord } from '../../content/anime'

  interface Props {
    item: AnimeRecord
  }

  let { item }: Props = $props()

  const aliases = $derived(item.aliases.slice(0, 2).join(' · '))
</script>

<article
  data-testid={`anime-${item.id}`}
  class="overflow-hidden rounded-xl border border-border bg-card shadow-xs"
>
  <div class="relative">
    {#if item.poster}
      <img
        src={item.poster}
        alt=""
        loading="lazy"
        class="aspect-[2/3] w-full bg-muted object-cover"
      />
    {/if}
    <span
      class="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-xs text-foreground"
      data-testid={`anime-kind-${item.id}`}>{item.kind ?? '—'}</span
    >
    {#if item.episodes}
      <span class="absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-xs text-foreground"
        >{item.episodes} сер.</span
      >
    {/if}
  </div>
  <div class="p-3">
    <h3 class="truncate text-sm font-medium text-foreground" title={item.title}>{item.title}</h3>
    <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{aliases}</p>
    <p class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      {#if item.score}
        <span data-testid={`anime-score-${item.id}`}>★ {item.score.toFixed(2)}</span>
      {/if}
      {#if item.year}<span>{item.year}</span>{/if}
      <span class="ml-auto">#{item.id}</span>
    </p>
    {#if item.url}
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        class="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        data-testid={`anime-link-${item.id}`}>на Shikimori</a
      >
    {/if}
  </div>
</article>
