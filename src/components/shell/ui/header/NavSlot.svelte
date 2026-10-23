<script lang="ts" module>
  import { variants, type VariantProps } from '#components/utils.js'

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
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { asLink } from '#hooks/links/index.js'
  import type { NavItem } from '../../types'

  interface Props {
    items: readonly NavItem[]
  }

  let { items }: Props = $props()
</script>

<nav class="flex items-center gap-1" aria-label="Основная навигация">
  {#each items as item (item.to)}
    {@const active = visibleAddress().url.pathname === item.to}
    <a
      {...asLink(item.to)}
      class={navPillVariants({ active })}
      aria-current={active ? 'page' : undefined}
    >
      {item.label}
    </a>
  {/each}
</nav>
