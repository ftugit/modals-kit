<script lang="ts">
  /**
   * Нативный выбор файла(ов). Своё значение у поля одно — выбранные файлы;
   * задать его разметкой нельзя (браузер запрещает писать `value` у
   * `type="file"`), поэтому `value` сюда не принимается: страница, вернувшаяся
   * с ошибкой, просит выбрать файл заново.
   *
   * Примитив отвечает только за `<input type="file">`, `bind:files` и `ref`.
   * Отображение выбранных файлов карточкой/плиткой живёт в `Attachment` и
   * комбинированном `FileAttachment`.
   */
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { inputVariants } from '../field/field'

  export interface FileInputProps
    extends Omit<HTMLInputAttributes, 'size' | 'type' | 'value' | 'files'> {
    size?: 'sm' | 'md' | 'lg'
    /** Выбранные файлы нативного `<input type="file">` (`bind:files`). */
    files?: FileList
    /** Forwarded ref: узел `<input>` в руки потребителю (фокус, очистка, слушатели формы; см. Input). */
    ref?: (el: HTMLInputElement | null) => void
  }

  let { size, files = $bindable(), ref, onchange, class: cls, ...rest }: FileInputProps = $props()

  let inputEl = $state<HTMLInputElement | null>(null)
  let prevFiles: FileList | undefined
  let prevRest = ''

  $effect(() => {
    const el = inputEl
    ref?.(el)
    const nextRest = JSON.stringify(rest)
    const restChanged = prevRest !== '' && nextRest !== prevRest
    prevRest = nextRest

    if (files !== prevFiles) {
      // В Svelte 5 несвязанный `$bindable()` при пересчёте `{...rest}` (например
      // `aria-invalid` на `blur` в `FileField`) сбрасывает локальный derived в `undefined`.
      if (files !== undefined || !restChanged) {
        if (el) {
          if (files) el.files = files
          else el.value = ''
        }
      }
      prevFiles = files
    }
    return () => {
      ref?.(null)
    }
  })
</script>

<input
  bind:this={inputEl}
  type="file"
  class={inputVariants({
    size,
    class: [
      'h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm file:text-foreground',
      cls,
    ],
  })}
  {...rest}
  onchange={(e) => {
    files = e.currentTarget.files ?? undefined
    onchange?.(e)
    prevFiles = files
  }}
/>
