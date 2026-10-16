<script lang="ts">
  // Ползунок (`range`): число без поля ввода, поэтому текущее значение показано
  // рядом. В форму уходит строка, как у NumberField: разбор — работа типа значения.
  import { Input } from '#lib/components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
  // Пусто — значение по умолчанию из описания: у ползунка «пусто» не бывает.
  const value = $derived(f.value ?? f.defaultValue ?? '')
</script>

<FieldShell {f}>
  <div class="flex items-center gap-3">
    <Input
      {...f.attrs}
      value={String(value)}
      class="flex-1 accent-primary"
      onchange={(e) => f.onInput(e.currentTarget.value)}
      oninput={(e) => f.onInput(e.currentTarget.value)}
    />
    <output class="w-10 text-right text-sm tabular-nums text-muted-foreground" for={String(f.attrs.id ?? '')}>{value}</output>
  </div>
</FieldShell>
