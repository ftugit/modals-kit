<script lang="ts">
  // Один файл или список (`files`). В форму уходит сам `File` (тип значения `file`)
  // или массив `File[]` (`files`), а не строка пути: правила `accept`/`maxSize`/
  // `minCount`/`maxCount` проверяют их и в браузере, и на сервере.
  //
  // Вид выбирает СТРАНИЦА, а не описание формы: `preview` включает гибрид
  // `FileAttachment` (выбранное видно), без него — голый `FileInput`. Сжатие
  // включается параметрами `photoConvert`: картинки приводятся к кадру и весу
  // до отправки, сервер делает то же для файла, пришедшего без JS.
  import { FileAttachment, FileInput } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'
  import { convertPhoto, type PhotoConvertSpec } from './photo-convert'

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

  async function handleChange(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const files = e.currentTarget.files
    const picked = f.input === 'files' ? [...(files ?? [])] : files?.[0] ? [files[0]] : []
    if (!photoConvert || !picked.length) {
      f.onInput(f.input === 'files' ? picked : (picked[0] ?? null))
      return
    }
    {
      const done: File[] = []
      for (const file of picked) {
        // не картинка — остаётся как есть: тип и размер судят правила поля
        const out = file.type.startsWith('image/') ? await convertPhoto(file, photoConvert) : null
        done.push(out?.ok ? out.file : file)
      }
      f.onInput(f.input === 'files' ? done : (done[0] ?? null))
    }
  }
</script>

<FieldShell {f}>
  {#if preview}
    <FileAttachment {...attrs} onblur={() => f.setTouched()} onchange={handleChange} />
  {:else}
    <FileInput {...attrs} onblur={() => f.setTouched()} onchange={handleChange} />
  {/if}
</FieldShell>
