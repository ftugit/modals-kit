<script lang="ts">
  // Компонент приложения. Индикатор считает ТОЙ ЖЕ функцией, что и валидатор:
  // иначе шкала и проверка разошлись бы, и пользователь видел бы «надёжный»
  // там, где форма не пропускает.
  import { strengthOf, type StrengthLevel } from '$lib/form'
  import { Input } from '$lib/ui/primitives'
  import type { FieldView } from '$lib/form/svelte'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()

  const LABEL: Record<StrengthLevel, string> = {
    weak: 'слабый', fair: 'средний', good: 'хороший', strong: 'надёжный',
  }
  const COLOR: Record<StrengthLevel, string> = {
    weak: 'bg-destructive', fair: 'bg-amber-500', good: 'bg-lime-500', strong: 'bg-emerald-500',
  }
  const ORDER: StrengthLevel[] = ['weak', 'fair', 'good', 'strong']

  const value = $derived(String(f.value ?? ''))
  const s = $derived(strengthOf(value))
  const filled = $derived(ORDER.indexOf(s.level) + 1)
</script>

<FieldShell {f}>
  <Input
    {...f.attrs}
    autocomplete="new-password"
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
  {#if value}
    <div class="mt-1.5 flex items-center gap-2">
      <div class="flex flex-1 gap-1" aria-hidden="true">
        {#each ORDER as _, i (i)}
          <span class="h-1.5 flex-1 rounded-full {i < filled ? COLOR[s.level] : 'bg-muted'}"></span>
        {/each}
      </div>
      <span class="w-28 text-right text-xs text-muted-foreground" aria-live="polite">
        {LABEL[s.level]} · {s.bits} бит
      </span>
    </div>
  {/if}
</FieldShell>
