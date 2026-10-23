<script lang="ts">
  import { asLink } from '#hooks/links/index.js'
  import type { NavItem } from '../../types'

  interface Props {
    items: readonly NavItem[]
  }

  let { items }: Props = $props()
</script>

<footer class="border-t border-border bg-muted/30">
  <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-5 px-4 py-8">
    <span class="text-sm text-muted-foreground">
      © 2026 dd · Svelte 5 + SvelteKit
    </span>
    <nav class="flex flex-wrap gap-5 text-sm" aria-label="Разделы сайта">
      {#each items as item (item.to)}
        <a {...asLink(item.to)} class="text-muted-foreground transition-colors hover:text-foreground">
          {item.label}
        </a>
      {/each}
    </nav>
  </div>
</footer>
