<!--
  Шаги страницы: навигация сверху слева (ссылка — заполненный шаг, текст —
  незаполненный, `aria-current="step"` — текущий) и логика текущего шага —
  сниппет с именем шага. Куда ведут ссылки, замок и переход — решает хост
  (`useSteps`), здесь только вид.

    <Steps host={steps} label="Шаги">
      {#snippet build()}…{/snippet}
      {#snippet fill()}…{/snippet}
    </Steps>
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { StepsHost } from './steps.svelte.js'

  let {
    host,
    label,
    nav = true,
    ...snippets
  }: { host: StepsHost; label: string; nav?: boolean } & Record<string, unknown> = $props()

  const items = $derived(host.items)
  const active = $derived((snippets as Record<string, Snippet>)[host.currentKey ?? ''] as Snippet | undefined)
</script>

{#if nav}<nav aria-label={label} class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
  {#each items as s, i (s.key)}
    {#if i > 0}<span aria-hidden="true" class="text-muted-foreground">/</span>{/if}
    {#if s.href !== null}
      <a
        href={s.href}
        class="font-medium underline-offset-4 hover:underline {s.locked ? 'pointer-events-none opacity-50' : ''}"
        aria-disabled={s.locked ? 'true' : undefined}
        aria-current={s.current ? 'step' : undefined}
        aria-busy={s.loading || undefined}
        {...s.props}>{s.label}</a
      >
    {:else}
      <span class="text-muted-foreground" aria-current={s.current ? 'step' : undefined}>{s.label}</span>
    {/if}
  {/each}
</nav>{/if}

{#if active}{@render active()}{/if}
