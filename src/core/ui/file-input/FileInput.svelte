<script lang="ts">
  /**
   * Нативный выбор файла(ов). Своё значение у поля одно — выбранные файлы;
   * задать его разметкой нельзя (браузер запрещает писать `value` у
   * `type="file"`), поэтому `value` сюда не принимается: страница, вернувшаяся
   * с ошибкой, просит выбрать файл заново.
   *
   * Примитив отвечает за `<input type="file">`, `bind:files`, `ref` и — если
   * переданы параметры — за приведение выбранных картинок до отправки. Показ
   * выбранных карточкой/плиткой живёт в `Attachment` и в гибриде `FileAttachment`,
   * который передаёт эти же параметры своему `FileInput`.
   */
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { inputVariants } from '../field/field'
  import { convertPhoto, type PhotoConvertSpec } from './convert'

  export type { PhotoConvertSpec }

  export interface FileInputProps
    extends Omit<HTMLInputAttributes, 'size' | 'type' | 'value' | 'files'> {
    size?: 'sm' | 'md' | 'lg'
    /** Выбранные файлы нативного `<input type="file">` (`bind:files`). */
    files?: FileList
    /** Forwarded ref: узел `<input>` в руки потребителю (фокус, очистка, слушатели формы; см. Input). */
    ref?: (el: HTMLInputElement | null) => void
    /**
     * Параметры приведения картинок: размеры кадра, предел веса, конечный формат.
     * Переданы — каждая выбранная картинка заменяется готовым файлом ДО того, как
     * значение уйдёт в форму; не картинка — остаётся как есть.
     */
    photoConvert?: PhotoConvertSpec
  }

  let { size, files = $bindable(), ref, onchange, photoConvert, class: cls, ...rest }: FileInputProps = $props()

  /**
   * Событие для обработчика после АСИНХРОННОЙ подготовки файла.
   *
   * У настоящего `Event` к этому моменту `currentTarget` уже `null`:
   * диспетчеризация закончилась, пока шло приведение картинки. Обработчики же
   * читают `e.currentTarget.files` — без этого узла карточка выбранного файла
   * не появлялась, а значение поля не обновлялось. Отдаём тот же узел в
   * стабильном виде: тип — как у настоящего события, данные — живые.
   */
  const eventOf = (el: HTMLInputElement): Event & { currentTarget: HTMLInputElement } =>
    ({ type: 'change', target: el, currentTarget: el }) as unknown as Event & {
      currentTarget: HTMLInputElement
    }

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
  onchange={async (e) => {
    const el = e.currentTarget
    if (photoConvert && el.files?.length) {
      // картинки приводятся к параметрам, остальное уходит как выбрано
      const out = new DataTransfer()
      for (const file of el.files) {
        if (!file.type.startsWith('image/')) { out.items.add(file); continue }
        const done = await convertPhoto(file, photoConvert)
        out.items.add(done.ok ? done.file : file)
      }
      el.files = out.files
      files = el.files
      prevFiles = files
      // `e.currentTarget` после await пуст — отдаём узел сами
      onchange?.(eventOf(el))
      return
    }
    files = el.files ?? undefined
    onchange?.(e)
    prevFiles = files
  }}
/>
