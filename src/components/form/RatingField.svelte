<script lang="ts">
  // Свой виджет — такой же гражданин, как встроенные: принимает то же
  // представление поля. Ни одного обращения к движку напрямую.
  //
  // Ползунок — `Range` из `ui/`, значение приводится к числу, справа — звёзды.
  import { Range } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
  const value = $derived(Number(f.value ?? 3))
</script>

<FieldShell {f}>
  <div class="flex items-center gap-3">
    <Range
      {...f.attrs}
      value={String(value)}
      wrapperClass="flex-1"
      onchange={(e) => f.onInput(Number(e.currentTarget.value))}
      oninput={(e) => f.onInput(Number(e.currentTarget.value))}
    />
    <span class="w-16 text-sm text-muted-foreground">{'★'.repeat(Math.max(0, value))}</span>
  </div>
</FieldShell>
