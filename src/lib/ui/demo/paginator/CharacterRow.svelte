<script lang="ts">
  import { rickMortyGenderLabel, rickMortyStatusLabel, type RickMortyCharacter } from '../../../../content/rickmorty'

  interface Props {
    item: RickMortyCharacter
  }

  let { item }: Props = $props()

  const kind = $derived(item.type ? `${item.species} · ${item.type}` : item.species)
</script>

<!--
  Строка персонажа Rick and Morty — в стиле строки Shikimori: аватар, имя,
  вид/подвид и служебная часть справа (`shrink-0` держит её от сжатия).
-->
<div
  data-testid={`rm-${item.id}`}
  class="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xs"
>
  {#if item.image}
    <img src={item.image} alt="" width="32" height="32" loading="lazy" class="size-8 shrink-0 rounded" />
  {:else}
    <span class="size-8 shrink-0 rounded bg-muted"></span>
  {/if}
  <span class="min-w-0">
    <span class="block truncate font-medium">{item.name}</span>
    <span class="block truncate text-xs text-muted-foreground">{kind}</span>
  </span>
  <span class="ml-auto shrink-0 text-xs text-muted-foreground">
    {rickMortyStatusLabel(item.status)} · {rickMortyGenderLabel(item.gender)}
  </span>
</div>
