<script lang="ts" module>
  import { variants, type VariantProps } from '$lib/ui/cn'

  export const navPillVariants = variants(
    'nav-pill inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    {
      active: {
        true: 'nav-pill-active bg-accent text-accent-foreground font-semibold',
        false: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      },
    },
    {
      active: false,
    },
  )

  export type NavPillVariants = VariantProps<typeof navPillVariants>
</script>

<script lang="ts">
  import { page } from '$app/state'
  import { NAV_ITEMS } from './nav'
</script>

<nav class="flex items-center gap-1" aria-label="Основная навигация">
  {#each NAV_ITEMS as item}
    {@const active = page.url.pathname === item.to}
    <a
      href={item.to}
      class={navPillVariants({ active })}
      aria-current={active ? 'page' : undefined}
    >
      {item.label}
    </a>
  {/each}
</nav>
