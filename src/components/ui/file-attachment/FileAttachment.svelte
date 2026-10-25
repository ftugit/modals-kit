<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte'
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { cn } from '#components/utils.js'
  import {
    Attachment,
    AttachmentAction,
    normalizeAttachment,
    type AttachmentItem,
    type AttachmentLayout,
    type AttachmentMediaMode,
    type AttachmentProps,
    type AttachmentSize,
    type NormalizedAttachment,
  } from '../attachment'
  import CloseIcon from '../close-icon/CloseIcon.svelte'
  import FileInput from '../file-input/FileInput.svelte'
  import type { PhotoConvertSpec } from '../file-input/convert'

  /**
   * Раскладка списка файлов. `'strip'` — одна строка с горизонтальным
   * скроллом; карточки в ней не сжимаются и остаются размером плитки.
   */
  export type FileAttachmentLayout = AttachmentLayout | 'strip'

  export interface FileAttachmentActionContext {
    /** `undefined` у показанного вложения: файла в `input.files` нет. */
    file?: File
    index: number
    item: NormalizedAttachment
    /** Убирает выбранный файл из `FileList` или зовёт `onremove` у показанного. */
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
    /**
     * Раскладка карточек: `'row'` — файл на строку, `'strip'` — все в одну
     * строку со скроллом, `'tile'` — плитка с переносом.
     */
    layout?: FileAttachmentLayout
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
    /**
     * Параметры приведения картинок: гибрид не сжимает сам — он передаёт их
     * своему `FileInput`, чтобы сжатие оставалось одной возможностью примитива.
     */
    photoConvert?: PhotoConvertSpec
    /**
     * Уже загруженные вложения: рисуются теми же карточками `Attachment`, но
     * без `File`. В значение поля и `FormData` они не попадают.
     */
    items?: readonly AttachmentItem[]
    /**
     * Что делать с `items`, когда выбран файл: `'replace'` — выбранный их
     * заменяет (аватар), `'append'` — остаются слева от выбранных (галерея).
     * @default 'replace'
     */
    mode?: 'replace' | 'append'
    /** Снятие показанного вложения: `input.files` не трогается, решает страница. */
    onremove?: (item: AttachmentItem, index: number) => void
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
    photoConvert,
    items = [],
    mode = 'replace',
    onremove,
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

  /** В `replace` выбранный файл занимает место показанных вложений. */
  const shownItems = $derived(mode === 'append' || pickedFiles.length === 0 ? items : [])
  const hasList = $derived(shownItems.length > 0 || pickedFiles.length > 0)
  const showExistingActions = $derived(Boolean(customActions || (removable && onremove)))

  /** Один и тот же файл, выбранный дважды: имя, вес и время правки. */
  const sameFile = (a: File, b: File): boolean =>
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified

  /**
   * Дополнить выбор новыми файлами (`multiple`): второй заход в диалог не
   * затирает первый. Возвращает накопленный список без повторов — повторный
   * выбор того же файла ничего не меняет.
   */
  function mergePicked(current: readonly File[], added: readonly File[]): File[] {
    const out = [...current]
    for (const file of added) if (!out.some((x) => sameFile(x, file))) out.push(file)
    return out
  }

  /**
   * Признак «change вызвали мы сами»: удаление файла меняет `input.files`, и
   * склеивать это событие с прежним выбором нельзя — удалённый файл вернулся бы.
   */
  let ownMutation = false

  /** Положить накопленный выбор в нативный `input`, чтобы форма унесла всё. */
  function syncInput(files: File[]): FileList | undefined {
    if (!inputEl || typeof DataTransfer === 'undefined') return undefined
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(f)
    inputEl.files = dt.files
    return dt.files
  }

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
    ownMutation = true
    inputEl.dispatchEvent(new Event('change', { bubbles: true }))
    ownMutation = false
  }

  const rootClass = $derived(cn('flex flex-col gap-2', wrapperClass))
  const ulClass = $derived(
    cn(
      layout === 'strip'
        ? 'flex flex-nowrap gap-2.5 overflow-x-auto pb-1'
        : layout === 'tile'
          ? 'flex flex-wrap gap-2.5'
          : 'flex flex-col gap-2',
      listClass,
    ),
  )

  // В полосе карточки — как плитка: строка не сжимает их до нечитаемого
  const cardLayout = $derived<AttachmentLayout>(layout === 'row' ? 'row' : 'tile')
  const cardWrapClass = $derived(layout === 'strip' ? 'shrink-0' : undefined)
</script>

<div data-slot="file-attachment" class={rootClass}>
  <FileInput
    ref={handleRef}
    {size}
    {photoConvert}
    class={cls}
    {...rest}
    onchange={(e) => {
      const raw = e.currentTarget.files
      const added = raw && raw.length > 0 ? Array.from(raw) : []
      // `multiple` копит выбор из разных папок: диалог браузера отдаёт только
      // последнюю выборку, поэтому прежнюю склеиваем сами и кладём в input
      const accumulate = Boolean(inputEl?.multiple) && !ownMutation
      const list = accumulate ? mergePicked(pickedFiles, added) : added
      pickedFiles = list
      if (list.length === 0) {
        files = undefined
      } else {
        // склейка дала больше файлов, чем диалог отдал в этот раз, — кладём в input
        const kept = accumulate && list.length !== added.length ? syncInput(list) : undefined
        files = kept ?? raw ?? undefined
      }
      onchange?.(e)
      prevFiles = files
    }}
  />

  {#if mounted && hasList}
    <ul class={ulClass} data-file-list>
      {#each shownItems as item, index (item.id)}
        {@const shown = normalizeAttachment({ item })}
        {#snippet existingActions()}
          {#if customActions}
            {@render customActions({ index, item: shown, remove: () => onremove?.(item, index) })}
          {/if}
          {#if removable && onremove}
            <AttachmentAction
              aria-label={`${removeLabel}: ${shown.filename}`}
              title={removeLabel}
              disabled={Boolean(rest.disabled)}
              onclick={() => onremove?.(item, index)}
            >
              <CloseIcon size={16} />
            </AttachmentAction>
          {/if}
        {/snippet}
        <li data-existing-item class={cardWrapClass}>
          <Attachment
            {item}
            layout={cardLayout}
            size={cardSize}
            {media}
            {showFilename}
            {showSize}
            disabled={Boolean(rest.disabled)}
            actions={showExistingActions ? existingActions : undefined}
          />
        </li>
      {/each}
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
        <li data-file-item class={cardWrapClass}>
          <Attachment
            {file}
            layout={cardLayout}
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
