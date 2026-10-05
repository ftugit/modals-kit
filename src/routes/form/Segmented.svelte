<script lang="ts">
  // Тот же Segmented, что у демонстрации модалок: переключатель вариантов.
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
      onclick={() => onChange(o.value)}
      title={o.hint}
      aria-pressed={o.value === value}
      class="rounded-md border px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors {o.value === value
        ? 'border-primary bg-background text-foreground shadow-sm ring-1 ring-primary/30'
        // не muted-foreground: на подложке bg-muted он даёт 4.39:1 — ниже порога
        // 4.5:1 для мелкого текста. Полупрозрачный цвет чернил держит контраст
        // в обеих темах и остаётся зрительно тише выбранной опции.
        : 'border-transparent text-foreground/70 hover:bg-accent hover:text-accent-foreground'}"
    >
      {o.label}
    </button>
  {/each}
</div>
