<script lang="ts">
  import type { Snippet } from 'svelte'
  import Checkbox from '../checkbox/Checkbox.svelte'
  import Label from '../label/Label.svelte'
  import Spinner from '../spinner/Spinner.svelte'
  import { cn } from '../../../utils'
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
    attachmentRadioClasses,
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
</script>

{#snippet kindIcon(cls: string)}
  {#if normalized.state === 'error'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  {:else if normalized.kind === 'image'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M21 15l-4.5-4.5L6 19" />
    </svg>
  {:else if normalized.kind === 'video'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <polygon points="10 9 15 12 10 15 10 9" />
    </svg>
  {:else if normalized.kind === 'audio'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </svg>
  {:else if normalized.kind === 'archive'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  {:else if normalized.kind === 'code'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <polyline points="8 8 4 12 8 16" />
      <polyline points="16 8 20 12 16 16" />
      <line x1="13.5" y1="6" x2="10.5" y2="18" />
    </svg>
  {:else if normalized.kind === 'document'}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  {:else}
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  {/if}
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
    <input
      type="radio"
      id={inputId}
      {name}
      value={normalized.option.value}
      {form}
      {required}
      disabled={isDisabled}
      checked={isControlledSingle ? isSelected : (defaultChecked ? true : undefined)}
      onchange={handleControlChange}
      class={attachmentRadioClasses}
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
        <path d="M15 3h6v6" />
        <path d="M10 14L21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
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
  <span
    data-slot="attachment-media"
    data-variant={mediaVariant}
    class={cn(
      attachmentMediaVariants({ layout: 'row', size, variant: mediaVariant }),
      attachmentRowMediaSize[size],
    )}
  >
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
      {@render kindIcon(attachmentIconSize[size])}
    {/if}
  </span>

  <span data-slot="attachment-content" class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
    {#if showFilename}
      <span
        data-slot="attachment-title"
        class={cn(
          'truncate font-medium text-card-foreground',
          size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm',
        )}
      >
        {normalized.filename}
      </span>
    {:else if selection !== 'none'}
      <span class="sr-only">{normalized.label}</span>
    {/if}

    {#if errorText}
      <span
        data-slot="attachment-description"
        class="truncate text-xs font-medium text-destructive"
      >
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

{#snippet tileBody()}
  <span
    data-slot="attachment-media"
    data-variant={mediaVariant}
    class={cn(
      'absolute inset-0 flex items-center justify-center overflow-hidden',
      mediaVariant === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
    )}
  >
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
      {@render kindIcon(attachmentTileIconSize[size])}
    {/if}
  </span>

  {#if hasFooterText}
    <span
      data-slot="attachment-content"
      class="relative z-10 flex w-full min-w-0 flex-col gap-0.5 border-t border-border bg-card px-2.5 py-1.5 text-left"
    >
      {#if showFilename}
        <span
          data-slot="attachment-title"
          class="truncate text-xs font-medium text-card-foreground"
        >
          {normalized.filename}
        </span>
      {:else if selection !== 'none'}
        <span class="sr-only">{normalized.label}</span>
      {/if}

      {#if errorText}
        <span
          data-slot="attachment-description"
          class="truncate text-xs font-medium text-destructive"
        >
          {errorText}
        </span>
      {:else if subtitleParts.length > 0}
        <span
          data-slot="attachment-description"
          class="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground"
        >
          {#if normalized.state === 'uploading' || normalized.state === 'processing'}
            <Spinner size="xs" aria-label={normalized.stateLabel} class="shrink-0" />
          {/if}
          <span class="truncate">{subtitleParts.join(' · ')}</span>
        </span>
      {/if}
    </span>
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
  {#if showProgress && progressVariant === 'background'}
    <div
      data-slot="attachment-progress"
      data-variant="background"
      role="progressbar"
      aria-label={`${normalized.stateLabel}: ${normalized.label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized.progress ?? undefined}
      class={cn(
        'pointer-events-none absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-200',
        normalized.progress === null && 'animate-pulse',
      )}
      style:width={normalized.progress !== null ? `${normalized.progress}%` : '100%'}
    ></div>
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

  {#if showProgress && progressVariant === 'strip'}
    <div
      data-slot="attachment-progress"
      data-variant="strip"
      role="progressbar"
      aria-label={`${normalized.stateLabel}: ${normalized.label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized.progress ?? undefined}
      class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1.5 overflow-hidden bg-primary/10"
    >
      <div
        class={cn(
          'h-full bg-primary transition-[width] duration-200',
          normalized.progress === null && 'animate-pulse',
        )}
        style:width={normalized.progress !== null ? `${normalized.progress}%` : '40%'}
      ></div>
    </div>
  {/if}
</div>
<!-- UnoCSS variant tokens extracted when Attachment.svelte is loaded:
     aspect-square justify-between border-dashed bg-muted/40 border-destructive/40 bg-destructive/10
     rounded-md rounded-lg rounded-xl min-h-14 min-h-20 h-24 px-2.5 px-3.5 px-4 py-2 py-2.5 py-3
     gap-2.5 gap-3 gap-4 w-28 h-32 w-44 size-9 size-10 size-12 size-4 size-5 size-8 -->
