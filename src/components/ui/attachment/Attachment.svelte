<script lang="ts">
  import type { Snippet } from 'svelte'
  import Checkbox from '../checkbox/Checkbox.svelte'
  import Label from '../label/Label.svelte'
  import RadioItem from '../radio-group/RadioItem.svelte'
  import Spinner from '../spinner/Spinner.svelte'
  import { cn } from '#components/utils.js'
  import AttachmentAction from './AttachmentAction.svelte'
  import {
    normalizeAttachment,
    toggleAttachmentValue,
    type AttachmentItem,
    type AttachmentKind,
    type AttachmentLayout,
    type AttachmentMediaMode,
    type AttachmentOption,
    type AttachmentProgressVariant,
    type AttachmentSelectionMode,
    type AttachmentSize,
    type AttachmentState,
    type NormalizedAttachment,
  } from './model.js'
  import {
    attachmentIconSize,
    attachmentMediaVariants,
    attachmentRowMediaSize,
    attachmentRowSpacing,
    attachmentTileIconSize,
    attachmentTileSize,
    attachmentVariants,
  } from './variants.js'

  export interface AttachmentProps {
    ref?: (el: HTMLDivElement | null) => void
    /** Локальный `File` из `<FileInput>` для client-only object URL превью. */
    file?: File
    /** Доменное описание существующего вложения. */
    item?: AttachmentItem
    /** Явная опция выбора формы (по умолчанию выводится из `item` / пропов). */
    option?: AttachmentOption
    id?: string
    /** Отображаемое имя файла. Имя поля формы задаётся отдельно через `name`. */
    filename?: string
    description?: string
    byteSize?: number
    mimeType?: string
    kind?: AttachmentKind
    previewUrl?: string
    alt?: string
    layout?: AttachmentLayout
    size?: AttachmentSize
    state?: AttachmentState
    media?: AttachmentMediaMode
    showFilename?: boolean
    showSize?: boolean
    progress?: number | null
    progressVariant?: AttachmentProgressVariant
    error?: string
    /** Режим выбора: `none` (без input), `single` (radio), `multiple` (checkbox). */
    selection?: AttachmentSelectionMode
    /** Атрибут `name` нативного `<input>` при `selection !== 'none'`. */
    name?: string
    /** Строковое значение поля формы при `selection !== 'none'`. */
    value?: string
    form?: string
    required?: boolean
    disabled?: boolean
    defaultChecked?: boolean
    checked?: boolean
    selectedValue?: string
    selectedValues?: string[]
    onCheckedChange?: (checked: boolean, option: AttachmentOption) => void
    /** Опциональное независимое действие открытия/просмотра (sibling вне `<label>`). */
    onOpen?: (item: NormalizedAttachment) => void
    openLabel?: string
    mediaSlot?: Snippet<[{ item: NormalizedAttachment }]>
    trigger?: Snippet<[{ item: NormalizedAttachment; disabled: boolean }]>
    actions?: Snippet<[{ item: NormalizedAttachment; disabled: boolean }]>
    class?: string
  }

  let {
    ref,
    file,
    item,
    option,
    id,
    filename,
    description,
    byteSize,
    mimeType,
    kind,
    previewUrl,
    alt,
    layout = 'row',
    size = 'md',
    state: stateProp,
    media = 'auto',
    showFilename = true,
    showSize = true,
    progress,
    progressVariant = 'strip',
    error,
    selection = 'none',
    name,
    value,
    form,
    required,
    disabled = false,
    defaultChecked = false,
    checked = $bindable(),
    selectedValue = $bindable(),
    selectedValues = $bindable(),
    onCheckedChange,
    onOpen,
    openLabel,
    mediaSlot,
    trigger,
    actions,
    class: className,
  }: AttachmentProps = $props()

  const uid = $props.id()

  const normalized = $derived(
    normalizeAttachment({
      file,
      item,
      option,
      id,
      filename,
      description,
      byteSize,
      mimeType,
      kind,
      previewUrl,
      alt,
      state: stateProp,
      progress,
      error,
      value,
      disabled,
    }),
  )

  const inputId = $derived(id ?? `${uid}-${normalized.key}`)
  const isDisabled = $derived(normalized.option.disabled ?? false)

  // --- Client-only Object URL lifecycle (`image-transfer.md` R6) ---
  let failedSource = $state<File | string | null>(null)
  let blobUrl = $state<string | null>(null)

  const rawSource = $derived<File | string | null>(
    normalized.localFile ?? normalized.remotePreviewUrl ?? null,
  )
  const sourceFailed = $derived(rawSource !== null && failedSource === rawSource)

  const wantsImage = $derived.by(() => {
    if (sourceFailed || media === 'icon') return false
    if (media === 'image') return rawSource !== null
    if (normalized.localFile) return normalized.kind === 'image'
    return Boolean(normalized.remotePreviewUrl)
  })

  $effect(() => {
    const local = wantsImage ? normalized.localFile : undefined
    if (!local || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      blobUrl = null
      return
    }
    const created = URL.createObjectURL(local)
    blobUrl = created
    return () => {
      URL.revokeObjectURL(created)
    }
  })

  const activeImageSrc = $derived(
    wantsImage ? (normalized.localFile ? blobUrl : (normalized.remotePreviewUrl ?? null)) : null,
  )

  function handleImageError() {
    if (rawSource !== null) failedSource = rawSource
  }

  let rootEl = $state<HTMLDivElement | null>(null)
  $effect(() => {
    ref?.(rootEl)
    return () => ref?.(null)
  })

  // --- Selection state (uncontrolled SSR/no-JS + controlled bindings) ---
  let userChecked = $state<boolean | undefined>(undefined)

  const isControlledSingle = $derived(selectedValue !== undefined || checked !== undefined)

  const isSelected = $derived.by(() => {
    if (selection === 'single') {
      if (selectedValue !== undefined) return selectedValue === normalized.option.value
      if (checked !== undefined) return checked
      return Boolean(defaultChecked)
    }
    if (selection === 'multiple') {
      if (selectedValues !== undefined) {
        return selectedValues.includes(normalized.option.value)
      }
      if (checked !== undefined) return checked
      return userChecked ?? Boolean(defaultChecked)
    }
    return false
  })

  function handleControlChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement
    const nextChecked = target.checked
    if (selection === 'single') {
      if (nextChecked && selectedValue !== undefined) {
        selectedValue = normalized.option.value
      }
      checked = nextChecked
    } else if (selection === 'multiple') {
      userChecked = nextChecked
      if (selectedValues !== undefined) {
        const current = selectedValues.includes(normalized.option.value)
        if (current !== nextChecked) {
          selectedValues = toggleAttachmentValue(
            selectedValues,
            normalized.option.value,
            'multiple',
            isDisabled,
          )
        }
      }
      checked = nextChecked
    }
    onCheckedChange?.(nextChecked, normalized.option)
  }

  // --- Secondary metadata & state semantics ---
  const showProgress = $derived(
    normalized.state === 'uploading' ||
      normalized.state === 'processing' ||
      normalized.progress !== null,
  )

  const subtitleParts = $derived.by(() => {
    const parts: string[] = []
    if (showSize) {
      if (normalized.description) parts.push(normalized.description)
      else if (normalized.sizeText) parts.push(normalized.sizeText)
    }
    if (normalized.state === 'idle') {
      parts.push(normalized.stateLabel)
    } else if (normalized.state === 'uploading' || normalized.state === 'processing') {
      parts.push(
        normalized.progress !== null
          ? `${normalized.stateLabel} ${normalized.progress}%`
          : `${normalized.stateLabel}…`,
      )
    }
    return parts
  })

  const errorText = $derived(
    normalized.state === 'error' ? (normalized.error || normalized.stateLabel) : undefined,
  )

  const hasFooterText = $derived(
    showFilename || subtitleParts.length > 0 || Boolean(errorText),
  )

  const mediaVariant = $derived<'icon' | 'image' | 'error'>(
    activeImageSrc ? 'image' : normalized.state === 'error' ? 'error' : 'icon',
  )

  const ICON_PATHS = {
    error: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 8v4m0 4h.01',
    image:
      'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3M9 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3M21 15l-4.5-4.5L6 19',
    video: 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3m4 5 5 3-5 3z',
    audio:
      'M9 18V6l10-2v12M6.5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5m10-2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5',
    archive:
      'M4 4h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m1 4v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8m-9 4h4',
    code: 'M8 8 4 12l4 4m8-8 4 4-4 4m-2.5-10-3 12',
    document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5M9 13h6m-6 4h4',
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5',
  } as const

  const iconPath = $derived(
    normalized.state === 'error' ? ICON_PATHS.error : ICON_PATHS[normalized.kind],
  )
</script>

{#snippet mediaVisual(cls: string)}
  <span data-slot="attachment-media" data-variant={mediaVariant} class={cls}>
    {#if mediaSlot}
      {@render mediaSlot({ item: normalized })}
    {:else if activeImageSrc}
      <img
        src={activeImageSrc}
        alt={normalized.alt}
        onerror={handleImageError}
        class="size-full object-cover"
      />
    {:else}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={layout === 'tile' ? attachmentTileIconSize[size] : attachmentIconSize[size]}
      >
        <path d={iconPath} />
      </svg>
    {/if}
  </span>
{/snippet}

{#snippet metaContent(cls: string, titleCls: string)}
  <span data-slot="attachment-content" class={cls}>
    {#if showFilename}
      <span data-slot="attachment-title" class={titleCls}>{normalized.filename}</span>
    {:else if selection !== 'none'}
      <span class="sr-only">{normalized.label}</span>
    {/if}

    {#if errorText}
      <span data-slot="attachment-description" class="truncate text-xs font-medium text-destructive">
        {errorText}
      </span>
    {:else if subtitleParts.length > 0}
      <span
        data-slot="attachment-description"
        class="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
      >
        {#if normalized.state === 'uploading' || normalized.state === 'processing'}
          <Spinner size="xs" aria-label={normalized.stateLabel} class="shrink-0" />
        {/if}
        <span class="truncate">{subtitleParts.join(' · ')}</span>
      </span>
    {/if}
  </span>
{/snippet}

{#snippet selectionControl()}
  {#if selection === 'multiple'}
    <Checkbox
      id={inputId}
      {name}
      value={normalized.option.value}
      {form}
      {required}
      disabled={isDisabled}
      checked={isSelected}
      onchange={handleControlChange}
    />
  {:else if selection === 'single'}
    <RadioItem
      id={inputId}
      {name}
      value={normalized.option.value}
      {form}
      {required}
      disabled={isDisabled}
      checked={isControlledSingle ? isSelected : (defaultChecked ? true : undefined)}
      onchange={handleControlChange}
    />
  {/if}
{/snippet}

{#snippet siblingControls()}
  {#if trigger}
    {@render trigger({ item: normalized, disabled: isDisabled })}
  {:else if onOpen}
    <AttachmentAction
      data-slot="attachment-trigger"
      aria-label={openLabel ?? `Открыть ${normalized.label}`}
      disabled={isDisabled}
      onclick={() => onOpen(normalized)}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4"
      >
        <path d="M15 3h6v6M10 14 21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </svg>
    </AttachmentAction>
  {/if}
  {#if actions}
    <div data-slot="attachment-actions" class="flex shrink-0 items-center gap-0.5">
      {@render actions({ item: normalized, disabled: isDisabled })}
    </div>
  {/if}
{/snippet}

{#snippet rowBody()}
  {@render mediaVisual(
    cn(
      attachmentMediaVariants({ layout: 'row', size, variant: mediaVariant }),
      attachmentRowMediaSize[size],
    ),
  )}
  {@render metaContent(
    'flex min-w-0 flex-1 flex-col gap-0.5 text-left',
    cn(
      'truncate font-medium text-card-foreground',
      size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm',
    ),
  )}
{/snippet}

{#snippet tileBody()}
  {@render mediaVisual(
    cn(
      'absolute inset-0 flex items-center justify-center overflow-hidden',
      mediaVariant === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
    ),
  )}
  {#if hasFooterText}
    {@render metaContent(
      'relative z-10 flex w-full min-w-0 flex-col gap-0.5 border-t border-border bg-card px-2.5 py-1.5 text-left',
      'truncate text-xs font-medium text-card-foreground',
    )}
  {:else if selection !== 'none'}
    <span class="sr-only">{normalized.label}</span>
  {/if}
{/snippet}

<div
  bind:this={rootEl}
  data-slot="attachment"
  data-layout={layout}
  data-size={size}
  data-state={normalized.state}
  data-kind={normalized.kind}
  data-disabled={isDisabled ? '' : undefined}
  data-selected={selection !== 'none' && isSelected ? '' : undefined}
  class={cn(
    attachmentVariants({ layout, size, state: normalized.state }),
    layout === 'row' ? attachmentRowSpacing[size] : attachmentTileSize[size],
    selection !== 'none' && isSelected && 'border-primary',
    isDisabled && 'opacity-60',
    className,
  )}
>
  {#if showProgress}
    <div
      data-slot="attachment-progress"
      data-variant={progressVariant}
      role="progressbar"
      aria-label={`${normalized.stateLabel}: ${normalized.label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized.progress ?? undefined}
      class={progressVariant === 'background'
        ? cn(
            'pointer-events-none absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-200',
            normalized.progress === null && 'animate-pulse',
          )
        : 'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1.5 overflow-hidden bg-primary/10'}
      style:width={progressVariant === 'background'
        ? (normalized.progress !== null ? `${normalized.progress}%` : '100%')
        : undefined}
    >
      {#if progressVariant === 'strip'}
        <div
          class={cn(
            'h-full bg-primary transition-[width] duration-200',
            normalized.progress === null && 'animate-pulse',
          )}
          style:width={normalized.progress !== null ? `${normalized.progress}%` : '40%'}
        ></div>
      {/if}
    </div>
  {/if}

  {#if layout === 'row'}
    {#if selection !== 'none'}
      <div class="relative z-10 flex shrink-0 items-center">
        {@render selectionControl()}
      </div>
      <Label
        for={inputId}
        data-slot="attachment-label"
        class={cn(
          'relative z-10 flex min-w-0 flex-1 items-center gap-3 font-normal',
          isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        {@render rowBody()}
      </Label>
    {:else}
      <div class="relative z-10 flex min-w-0 flex-1 items-center gap-3">
        {@render rowBody()}
      </div>
    {/if}

    {#if trigger || onOpen || actions}
      <div class="relative z-10 flex shrink-0 items-center gap-1">
        {@render siblingControls()}
      </div>
    {/if}
  {:else}
    {#if selection !== 'none' || trigger || onOpen || actions}
      <div class="pointer-events-none relative z-10 flex w-full items-start justify-between gap-1.5 p-2">
        {#if selection !== 'none'}
          <div class="pointer-events-auto flex items-center rounded-md border border-border bg-card p-1 shadow-xs">
            {@render selectionControl()}
          </div>
        {/if}
        {#if trigger || onOpen || actions}
          <div class="pointer-events-auto ml-auto flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-xs">
            {@render siblingControls()}
          </div>
        {/if}
      </div>
    {/if}

    {#if selection !== 'none'}
      <Label
        for={inputId}
        data-slot="attachment-label"
        class={cn(
          'flex min-h-0 w-full flex-1 flex-col justify-end font-normal',
          isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        {@render tileBody()}
      </Label>
    {:else}
      <div class="flex min-h-0 w-full flex-1 flex-col justify-end">
        {@render tileBody()}
      </div>
    {/if}
  {/if}
</div>
<!-- UnoCSS variant tokens extracted when Attachment.svelte is loaded:
     aspect-square justify-between border-dashed bg-muted/40 border-destructive/40 bg-destructive/10
     rounded-md rounded-lg rounded-xl min-h-14 min-h-20 h-24 px-2.5 px-3.5 px-4 py-2 py-2.5 py-3
     gap-2.5 gap-3 gap-4 w-28 h-32 w-44 size-9 size-10 size-12 size-4 size-5 size-8 -->
