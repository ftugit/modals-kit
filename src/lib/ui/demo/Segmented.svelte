<script lang="ts">
  const base = 'rounded-md px-2 py-2 text-xs whitespace-nowrap transition-colors'
  const active = 'bg-background text-foreground shadow-sm'
  const inactive = 'hover:bg-accent hover:text-accent-foreground'
  const formActive = 'border border-primary ring-1 ring-primary/30 font-semibold'
  const formInactive = 'border border-transparent text-foreground/70 font-medium'
  const modalActive = 'font-medium'
  const modalInactive = 'text-muted-foreground font-medium'

  let {
    options,
    value,
    onChange,
    variant = 'modals',
  }: {
    options: { value: string; label: string; hint?: string }[]
    value: string
    onChange: (value: string) => void
    variant?: 'form' | 'modals'
  } = $props()
</script>

<div role="group" class="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1 rounded-lg bg-muted p-1">
  {#each options as option (option.value)}
    <button
      type="button"
      onclick={() => onChange(option.value)}
      title={option.hint}
      aria-pressed={option.value === value}
      class={`${base} ${option.value === value ? active : inactive} ${variant === 'form'
        ? option.value === value ? formActive : formInactive
        : option.value === value ? modalActive : modalInactive}`}
    >
      {option.label}
    </button>
  {/each}
</div>
