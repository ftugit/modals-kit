<script lang="ts" module>
  import { variants, type VariantProps } from '#lib/ui/cn.js'

  export const sidebarNavItemVariants = variants(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    {
      active: {
        true: 'bg-accent text-accent-foreground font-semibold',
        false: 'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
      },
    },
    {
      active: false,
    },
  )

  export type SidebarNavItemVariants = VariantProps<typeof sidebarNavItemVariants>
</script>

<script lang="ts">
  import { Link } from '#lib/ui/primitives/index.js'
  import { page } from '$app/state'
  import { NAV_ITEMS } from '../header/nav'
</script>

<nav class="flex flex-col gap-1 w-full" aria-label="Боковая навигация">
  <span class="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
    Навигация
  </span>
  {#each NAV_ITEMS as item}
    {@const active = page.url.pathname === item.to}
    <Link
      href={item.to}
      class={sidebarNavItemVariants({ active })}
      aria-current={active ? 'page' : undefined}
    >
      <span>{item.label}</span>
    </Link>
  {/each}
</nav>
