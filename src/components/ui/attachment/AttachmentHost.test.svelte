<script lang="ts">
  import Attachment from './Attachment.svelte'
  import AttachmentAction from './AttachmentAction.svelte'
  import type { AttachmentItem, AttachmentMediaMode } from './model'

  let {
    initialFile = undefined,
    initialMedia = 'auto',
    onRemoveAction,
    onOpenAction,
  }: {
    initialFile?: File
    initialMedia?: AttachmentMediaMode
    onRemoveAction?: (id: string) => void
    onOpenAction?: (id: string) => void
  } = $props()

  const singleItems: AttachmentItem[] = [
    { id: 'cov-1', filename: 'cover-alpha.webp', byteSize: 40_960, mimeType: 'image/webp' },
    { id: 'cov-2', filename: 'cover-beta.webp', byteSize: 81_920, mimeType: 'image/webp' },
    { id: 'cov-3', filename: 'cover-gamma.webp', byteSize: 20_480, mimeType: 'image/webp', state: 'done' },
  ]

  const multiItems: AttachmentItem[] = [
    { id: 'doc-1', filename: 'spec.pdf', byteSize: 204_800, mimeType: 'application/pdf' },
    { id: 'doc-2', filename: 'archive.zip', byteSize: 512_000, mimeType: 'application/zip' },
    { id: 'doc-3', filename: 'disabled.txt', byteSize: 1_024, mimeType: 'text/plain' },
  ]

  let fileOverride = $state<File | null | undefined>(undefined)
  let mediaOverride = $state<AttachmentMediaMode | undefined>(undefined)
  const currentFile = $derived(fileOverride === undefined ? initialFile : (fileOverride ?? undefined))
  const currentMedia = $derived(mediaOverride ?? initialMedia)
  let pickedSingle = $state<string | undefined>('cov-1')
  let pickedMulti = $state<string[]>(['doc-1'])
  let singleFlag = $state<boolean | undefined>()
  let latestRef = $state<HTMLDivElement | null>(null)
  const refHistory: Array<HTMLDivElement | null> = []

  export function setFile(next?: File) {
    fileOverride = next ?? null
  }
  export function setMedia(next: AttachmentMediaMode) {
    mediaOverride = next
  }
  export function getPickedSingle() {
    return pickedSingle
  }
  export function getPickedMulti() {
    return pickedMulti
  }
  export function getSingleFlag() {
    return singleFlag
  }
  export function getRef() {
    return latestRef
  }
  export function getRefHistory() {
    return refHistory
  }
</script>

<div data-testid="preview-zone">
  <Attachment
    file={currentFile}
    filename={currentFile ? undefined : 'placeholder.bin'}
    media={currentMedia}
    ref={(el) => {
      latestRef = el
      refHistory.push(el)
    }}
  />
</div>

<form data-testid="selection-form">
  <div data-testid="single-group">
    {#each singleItems as item (item.id)}
      <Attachment
        {item}
        selection="single"
        name="cover"
        bind:selectedValue={pickedSingle}
        onOpen={() => onOpenAction?.(item.id)}
      >
        {#snippet actions({ item: norm })}
          <AttachmentAction
            aria-label={`Удалить ${norm.label}`}
            onclick={() => onRemoveAction?.(item.id)}
          >
            ×
          </AttachmentAction>
        {/snippet}
      </Attachment>
    {/each}
  </div>

  <div data-testid="multi-group">
    {#each multiItems as item (item.id)}
      <Attachment
        {item}
        layout="tile"
        selection="multiple"
        name="docs"
        disabled={item.id === 'doc-3'}
        bind:selectedValues={pickedMulti}
        onOpen={() => onOpenAction?.(item.id)}
      >
        {#snippet actions({ item: norm, disabled })}
          <AttachmentAction
            aria-label={`Убрать ${norm.label}`}
            {disabled}
            onclick={() => onRemoveAction?.(item.id)}
          >
            ×
          </AttachmentAction>
        {/snippet}
      </Attachment>
    {/each}
  </div>

  <div data-testid="uninitialized-boolean">
    <Attachment
      filename="standalone-check.md"
      selection="multiple"
      name="flag"
      value="yes"
      bind:checked={singleFlag}
    />
  </div>
</form>
