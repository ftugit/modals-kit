<script lang="ts">
  // Один файл или список (`files`). В форму уходит сам `File` (тип значения `file`)
  // или массив `File[]` (`files`), а не строка пути: правила `accept`/`maxSize`/
  // `minCount`/`maxCount` проверяют их и в браузере, и на сервере.
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
    onchange={(e) => {
      const files = e.currentTarget.files
      f.onInput(f.input === 'files' ? [...(files ?? [])] : files?.[0] ?? null)
    }}
  />
</FieldShell>
