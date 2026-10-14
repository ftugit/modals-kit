<script lang="ts" module>
  import { variants, type VariantProps } from '#lib/ui/cn.js'

  export const navPillVariants = variants(
    // Своих классов нет и здесь: единственный «внешний» признак активного
    // пункта — `aria-current="page"`, который ставит разметка.
    'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    {
      active: {
        true: 'bg-accent text-accent-foreground font-semibold',
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
  import { Link } from '#lib/ui/primitives/index.js'
  import { page } from '$app/state'
  import { NAV_ITEMS } from './nav'
</script>

<nav class="flex items-center gap-1" aria-label="Основная навигация">
  {#each NAV_ITEMS as item}
    {@const active = page.url.pathname === item.to}
    <Link
      href={item.to}
      class={navPillVariants({ active })}
      aria-current={active ? 'page' : undefined}
    >
      {item.label}
    </Link>
  {/each}
</nav>
