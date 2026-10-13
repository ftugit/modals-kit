<script lang="ts">
  // Одноразовый код (примитив OtpInput). Число ячеек — из правила длины поля
  // (`v.maxLength(n)` → `maxlength`), без него — 6.
  import { OtpInput } from '#lib/ui/primitives/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
  const length = $derived(Number(f.attrs.maxlength) || 6)
</script>

<FieldShell {f}>
  <OtpInput
    {...f.attrs}
    {length}
    value={String(f.value ?? '')}
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
