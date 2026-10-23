<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import {
    Attachment,
    AttachmentAction,
    type AttachmentLayout,
    type AttachmentMediaMode,
    type AttachmentProps,
    type AttachmentSize,
    type NormalizedAttachment,
  } from '../attachment'
  import CloseIcon from '../close-icon/CloseIcon.svelte'
  import FileInput from '../file-input/FileInput.svelte'

  export interface FileAttachmentActionContext {
    file: File
    index: number
    item: NormalizedAttachment
    /** Удаляет файл из нативного `FileList` и отправляет всплывающее событие `change`. */
    remove: () => void
  }

  export type FileAttachmentItemMeta = Partial<
    Pick<
      AttachmentProps,
      | 'state'
      | 'progress'
      | 'progressVariant'
      | 'error'
      | 'description'
      | 'alt'
      | 'kind'
      | 'onOpen'
      | 'openLabel'
    >
  >

  export interface FileAttachmentProps
    extends Omit<HTMLInputAttributes, 'size' | 'type' | 'value' | 'files'> {
    size?: 'sm' | 'md' | 'lg'
    /** Выбранные файлы нативного `<input type="file">` (`bind:files`). */
    files?: FileList
    /** Forwarded ref нативного `<input type="file">`. */
    ref?: (el: HTMLInputElement | null) => void
    /** Раскладка карточек `Attachment`: `'row'` (список) или `'tile'` (плитка). */
    layout?: AttachmentLayout
    /** Размер карточек `Attachment` (по умолчанию совпадает с `size` или `'md'`). */
    attachmentSize?: AttachmentSize
    /** Режим медиа в `Attachment`: `'auto' | 'icon' | 'image'`. */
    media?: AttachmentMediaMode
    showFilename?: boolean
    showSize?: boolean
    /** Показывать ли штатную кнопку удаления файла из `FileList` (по умолчанию `true`). */
    removable?: boolean
    /** Подпись штатной кнопки уборки файла (`aria-label` и `title`). */
    removeLabel?: string
    /** Проекция состояния/прогресса/ошибки на конкретный выбранный `File`. */
    itemProps?: (file: File, index: number) => FileAttachmentItemMeta | undefined
    /** Дополнительные или заменяющие действия сценария для каждого файла. */
    actions?: Snippet<[FileAttachmentActionContext]>
    /** Класс корневого контейнера композиции (`FileInput` + список `Attachment`). */
    wrapperClass?: string
    /** Класс списка `<ul data-file-list>`. */
    listClass?: string
  }

  let {
    size,
    files = $bindable(),
    ref,
    layout = 'row',
    attachmentSize,
    media = 'auto',
    showFilename = true,
    showSize = true,
    removable = true,
    removeLabel = 'Убрать файл',
    itemProps,
    actions: customActions,
    onchange,
    wrapperClass,
    listClass,
    class: cls,
    ...rest
  }: FileAttachmentProps = $props()

  let mounted = $state(false)
  let inputEl = $state<HTMLInputElement | null>(null)
  let pickedFiles = $state<File[]>([])
  let prevFiles: FileList | undefined = untrack(() => files)
  let prevRest = ''

  onMount(() => {
    mounted = true
    const initial = files ?? inputEl?.files ?? undefined
    pickedFiles = initial && initial.length > 0 ? Array.from(initial) : []
    prevFiles = files
  })

  $effect(() => {
    const nextRest = JSON.stringify(rest)
    const restChanged = prevRest !== '' && nextRest !== prevRest
    prevRest = nextRest

    if (files !== prevFiles) {
      if (files !== undefined || !restChanged) {
        pickedFiles = files && files.length > 0 ? Array.from(files) : []
        if (inputEl) {
          if (files) inputEl.files = files
          else inputEl.value = ''
        }
      }
      prevFiles = files
    }
  })

  function handleRef(el: HTMLInputElement | null): void {
    inputEl = el
    ref?.(el)
  }

  // Стабильный ключ на экземпляр `File`, чтобы удаление одного файла из `multiple`
  // не пересоздавало соседние карточки `Attachment` и их `blob:` URL.
  const fileKeys = new WeakMap<File, number>()
  let nextKey = 0
  function keyOf(file: File): number {
    let k = fileKeys.get(file)
    if (k === undefined) {
      k = ++nextKey
      fileKeys.set(file, k)
    }
    return k
  }

  const cardSize = $derived<AttachmentSize>(attachmentSize ?? size ?? 'md')
  const showAnyActions = $derived(Boolean(removable || customActions))

  function removeAt(index: number): void {
    if (!inputEl || rest.disabled) return
    if (inputEl.multiple && pickedFiles.length > 1 && typeof DataTransfer !== 'undefined') {
      const dt = new DataTransfer()
      for (let j = 0; j < pickedFiles.length; j++) {
        if (j !== index) dt.items.add(pickedFiles[j]!)
      }
      inputEl.files = dt.files
    } else {
      inputEl.value = ''
    }
    inputEl.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const rootClass = $derived(cn('flex flex-col gap-2', wrapperClass))
  const ulClass = $derived(
    cn(layout === 'tile' ? 'flex flex-wrap gap-2.5' : 'flex flex-col gap-2', listClass),
  )
</script>

<div data-slot="file-attachment" class={rootClass}>
  <FileInput
    ref={handleRef}
    {size}
    class={cls}
    {...rest}
    onchange={(e) => {
      const raw = e.currentTarget.files
      const list = raw && raw.length > 0 ? Array.from(raw) : []
      pickedFiles = list
      files = list.length > 0 ? (raw ?? undefined) : undefined
      onchange?.(e)
      prevFiles = files
    }}
  />

  {#if mounted && pickedFiles.length > 0}
    <ul class={ulClass} data-file-list>
      {#each pickedFiles as file, index (keyOf(file))}
        {@const extra = itemProps?.(file, index)}
        {#snippet itemActions({ item }: { item: NormalizedAttachment })}
          {#if customActions}
            {@render customActions({
              file,
              index,
              item,
              remove: () => removeAt(index),
            })}
          {/if}
          {#if removable}
            <AttachmentAction
              aria-label={`${removeLabel}: ${file.name}`}
              title={removeLabel}
              disabled={Boolean(rest.disabled)}
              onclick={() => removeAt(index)}
            >
              <CloseIcon size={16} />
            </AttachmentAction>
          {/if}
        {/snippet}
        <li data-file-item>
          <Attachment
            {file}
            {layout}
            size={cardSize}
            {media}
            {showFilename}
            {showSize}
            disabled={Boolean(rest.disabled)}
            actions={showAnyActions ? itemActions : undefined}
            {...extra}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>
