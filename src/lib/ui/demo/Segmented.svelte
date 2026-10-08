<script lang="ts">
  const formActive = 'rounded-md border border-primary bg-background px-2 py-2 text-xs font-semibold whitespace-nowrap text-foreground shadow-sm ring-1 ring-primary/30 transition-colors'
  const formInactive = 'rounded-md border border-transparent px-2 py-2 text-xs font-medium whitespace-nowrap text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground'
  const modalActive = 'rounded-md bg-background px-2 py-2 text-xs font-medium whitespace-nowrap text-foreground shadow-sm transition-colors'
  const modalInactive = 'rounded-md px-2 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'

  let {
    options,
    value,
    onChange,
    ariaLabel,
    variant = 'modals',
  }: {
    options: { value: string; label: string; hint?: string }[]
    value: string
    onChange: (value: string) => void
    ariaLabel?: string
    variant?: 'form' | 'modals'
  } = $props()
</script>

<div
  role="group"
  aria-label={ariaLabel}
  class="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1 rounded-lg bg-muted p-1"
>
  {#each options as option (option.value)}
    {@const active = option.value === value}
    <button
      type="button"
      onclick={() => onChange(option.value)}
      title={option.hint}
      aria-pressed={active}
      class={variant === 'form' ? (active ? formActive : formInactive) : (active ? modalActive : modalInactive)}
    >
      {option.label}
    </button>
  {/each}
</div>
