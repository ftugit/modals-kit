<script lang="ts">
  import { page } from '$app/state'
  import { NAV_ITEMS } from './nav'
</script>

<nav class="flex items-center gap-1" aria-label="Основная навигация">
  {#each NAV_ITEMS as item}
    {@const active = page.url.pathname === item.to}
    <a
      href={item.to}
      class={`nav-pill ${active ? 'nav-pill-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {item.label}
    </a>
  {/each}
</nav>
