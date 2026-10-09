<script lang="ts">
  import { animeKindLabel, animeStatusLabel, animeTitle, type AnimeCard } from '../../content/shikimori'

  interface Props {
    item: AnimeCard
  }

  let { item }: Props = $props()

  const title = $derived(animeTitle(item))
  const year = $derived(item.year ? ` · ${item.year}` : '')
  const score = $derived(item.score ? `★ ${item.score.toFixed(1)}` : '—')
</script>

<!--
  Строка списка: миниатюра, названия, служебная строка и оценка — как список
  каталога у канона. Ссылки ведут на страницу тайтла, смещение правой части
  держат только атомарные утилиты, `shrink-0` защищает оценку от сжатия.
-->
<a
  data-testid={`anime-${item.id}`}
  href={item.url}
  rel="noreferrer noopener"
  target="_blank"
  class="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xs transition-colors hover:bg-accent"
>
  {#if item.thumb}
    <img src={item.thumb} alt="" width="32" height="32" class="size-8 shrink-0 rounded" />
  {:else}
    <span class="size-8 shrink-0 rounded bg-muted"></span>
  {/if}
  <span class="min-w-0">
    <span class="block truncate font-medium">{title}</span>
    {#if item.russian && item.name !== item.russian}
      <span class="block truncate text-xs text-muted-foreground">{item.name}</span>
    {/if}
  </span>
  <span class="ml-auto shrink-0 text-xs text-muted-foreground">
    {animeKindLabel(item.kind)} · {animeStatusLabel(item.status)}{year}
  </span>
  <span class="w-14 shrink-0 text-right text-xs font-medium">{score}</span>
</a>
