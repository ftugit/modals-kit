<script lang="ts">
  import { AttachmentAction, type AttachmentItem } from '../attachment'
  import type { PhotoConvertSpec } from '../file-input/convert'
  import type { FileAttachmentLayout } from './FileAttachment.svelte'
  import FileAttachment, { type FileAttachmentItemMeta } from './FileAttachment.svelte'

  let {
    multiple = true,
    removable = true,
    layout = 'row' as FileAttachmentLayout,
    useCustomActions = false,
    onChangeFiles,
    onInspect,
    photoConvert,
    items = [],
    mode,
    onRemoveExisting,
  }: {
    multiple?: boolean
    removable?: boolean
    layout?: FileAttachmentLayout
    useCustomActions?: boolean
    onChangeFiles?: (names: string[]) => void
    onInspect?: (name: string) => void
    photoConvert?: PhotoConvertSpec
    items?: AttachmentItem[]
    mode?: 'replace' | 'append'
    onRemoveExisting?: (id: string) => void
  } = $props()

  let files = $state<FileList | undefined>()
  let latestRef = $state<HTMLInputElement | null>(null)
  const refHistory: Array<HTMLInputElement | null> = []
  let metaMap = $state<Record<string, FileAttachmentItemMeta>>({})
  let removedIds = $state<string[]>([])

  export function getFiles() {
    return files
  }
  export function clearFiles() {
    files = undefined
  }
  export function setMeta(filename: string, meta: FileAttachmentItemMeta) {
    metaMap = { ...metaMap, [filename]: meta }
  }
  export function getRemoved() {
    return removedIds
  }
  export function getRef() {
    return latestRef
  }
  export function getRefHistory() {
    return refHistory
  }
</script>

<form data-testid="fa-form">
  {#if useCustomActions}
    <FileAttachment
      name="uploads"
      {multiple}
      {removable}
      {layout}
      {photoConvert}
      {items}
      {mode}
      onremove={(item, index) => {
        removedIds = [...removedIds, `${item.id}:${index}`]
        onRemoveExisting?.(item.id)
      }}
      bind:files
      itemProps={(f) => metaMap[f.name]}
      ref={(el) => {
        latestRef = el
        refHistory.push(el)
      }}
      onchange={(e) => {
        onChangeFiles?.(Array.from(e.currentTarget.files ?? [], (f) => f.name))
      }}
    >
      {#snippet actions({ file, remove })}
        <AttachmentAction
          aria-label={`Инфо ${file?.name}`}
          onclick={() => onInspect?.(file?.name ?? '')}
        >
          i
        </AttachmentAction>
        <AttachmentAction
          aria-label={`Свой сброс ${file?.name}`}
          onclick={() => remove()}
        >
          ×
        </AttachmentAction>
      {/snippet}
    </FileAttachment>
  {:else}
    <FileAttachment
      name="uploads"
      {multiple}
      {removable}
      {layout}
      {photoConvert}
      {items}
      {mode}
      onremove={(item, index) => {
        removedIds = [...removedIds, `${item.id}:${index}`]
        onRemoveExisting?.(item.id)
      }}
      bind:files
      itemProps={(f) => metaMap[f.name]}
      ref={(el) => {
        latestRef = el
        refHistory.push(el)
      }}
      onchange={(e) => {
        onChangeFiles?.(Array.from(e.currentTarget.files ?? [], (f) => f.name))
      }}
    />
  {/if}
</form>
