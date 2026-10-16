<script lang="ts">
  // Один файл. В форму уходит сам `File` (тип значения `file`), а не строка пути:
  // правила `accept`/`maxSize` проверяют его и в браузере, и на сервере.
  import { FileInput } from '#lib/components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
  // `value` у type="file" браузер писать не даёт: атрибут из связки отбрасывается
  const attrs = $derived.by(() => {
    const { value: _value, ...rest } = f.attrs as Record<string, unknown>
    return rest
  })
</script>

<FieldShell {f}>
  <FileInput
    {...attrs}
    onblur={() => f.setTouched()}
    onchange={(e) => f.onInput(e.currentTarget.files?.[0] ?? null)}
  />
</FieldShell>
