<script lang="ts">
  // Один файл или список (`multiple`). В форму уходит сам `File` или несколько
  // `File` под одним именем, а не строка пути: правила `accept`/`maxSize`/
  // `minCount`/`maxCount` проверяют их и в браузере, и на сервере.
  //
  // Вид выбирает СТРАНИЦА: `preview` включается опцией и ставит гибрид
  // `FileAttachment` (выбранное видно) вместо голого `FileInput`. Сжатие —
  // возможность примитива: `photoConvert` уходит в `FileInput` напрямую или
  // через `FileAttachment`. Здесь нет ни своей конвертации, ни перехвата.
  import { FileAttachment, FileInput, type PhotoConvertSpec } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let {
    preview = false,
    photoConvert,
    ...f
  }: FieldView & { preview?: boolean; photoConvert?: PhotoConvertSpec } = $props()

  // `value` у type="file" браузер писать не даёт: атрибут из связки отбрасывается
  const attrs = $derived.by(() => {
    const { value: _value, ...rest } = f.attrs as Record<string, unknown>
    return rest
  })

  function handleChange(e: Event & { currentTarget: HTMLInputElement }): void {
    const picked = e.currentTarget.files ? [...e.currentTarget.files] : []
    f.onInput(f.multiple ? picked : (picked[0] ?? null))
  }
</script>

<FieldShell {f}>
  {#if preview}
    <FileAttachment {...attrs} {photoConvert} onblur={() => f.setTouched()} onchange={handleChange} />
  {:else}
    <FileInput {...attrs} {photoConvert} onblur={() => f.setTouched()} onchange={handleChange} />
  {/if}
</FieldShell>
