<script lang="ts" module>
  import { variants, type VariantProps } from '$lib/ui/cn'

  export const segmentedItemVariants = variants(
    'rounded-md px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors',
    {
      active: {
        true: 'bg-background text-foreground shadow-sm',
        false: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      },
    },
    {
      active: false,
    },
  )

  export type SegmentedItemVariants = VariantProps<typeof segmentedItemVariants>
</script>

<script lang="ts">
  // Порт самодельного Segmented из src/features/modals/ModalsDemo.tsx оригинала;
  // там нет shadcn Tabs для этого контрола. Дженерик-типы Solid здесь не нужны:
  // значение всегда строка, а тип контролирует страница через union у $state.
  let {
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: { value: string; label: string; hint?: string }[]
    value: string
    onChange: (v: string) => void
    ariaLabel?: string
  } = $props()
</script>

<div
  role="group"
  aria-label={ariaLabel}
  class="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1 rounded-lg bg-muted p-1"
>
  {#each options as o (o.value)}
    <button
      type="button"
      aria-pressed={o.value === value}
      onclick={() => onChange(o.value)}
      title={o.hint}
      class={segmentedItemVariants({ active: o.value === value })}
    >
      {o.label}
    </button>
  {/each}
</div>
