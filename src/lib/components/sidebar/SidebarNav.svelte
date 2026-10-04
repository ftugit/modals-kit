<script lang="ts">
  import { page } from '$app/state'
  import { NAV_ITEMS } from '../header/nav'
</script>

<nav class="flex flex-col gap-1 w-full" aria-label="Боковая навигация">
  <span class="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
    Навигация
  </span>
  {#each NAV_ITEMS as item}
    {@const active = page.url.pathname === item.to}
    <a
      href={item.to}
      class={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <span>{item.label}</span>
    </a>
  {/each}
</nav>
