<script lang="ts">
  import { rickMortyStatusLabel, type RickMortyCharacter } from '#content/demo-catalog/rickmorty/rickmorty.js'

  interface Props {
    item: RickMortyCharacter
  }

  let { item }: Props = $props()
</script>

<!-- Плитка колонок: квадратный аватар (API отдаёт 300×300) и подпись. -->
<figure data-testid={`rm-${item.id}`} class="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
  {#if item.image}
    <img src={item.image} alt="" loading="lazy" class="aspect-square w-full object-cover" />
  {:else}
    <div class="aspect-square w-full bg-muted"></div>
  {/if}
  <figcaption class="p-2">
    <span class="block truncate text-xs font-medium">{item.name}</span>
    <span class="block truncate text-[11px] text-muted-foreground">
      {item.species} · {rickMortyStatusLabel(item.status)}
    </span>
  </figcaption>
</figure>
