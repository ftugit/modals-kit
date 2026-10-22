<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'
  import FileInput from './FileInput.svelte'

  interface Props {
    multiple?: boolean
    preview?: boolean
    unbound?: boolean
    removeLabel?: string
    attrs?: Omit<HTMLInputAttributes, 'size' | 'type' | 'value' | 'files'>
    onPicked?: (seenInChange: FileList | undefined, fromTarget: FileList | null) => void
  }

  let { multiple = false, preview = false, unbound = false, removeLabel, attrs, onPicked }: Props = $props()

  let files = $state<FileList>()
  let el = $state<HTMLInputElement | null>(null)
  let value = $state<File | File[] | null>(null)
  let rev = $state(0)
  const history: Array<HTMLInputElement | null> = []

  const spreadAttrs = $derived({
    name: 'upload',
    multiple,
    'data-rev': rev,
    ...attrs,
  })

  const grab = (node: HTMLInputElement | null): void => {
    el = node
    history.push(node)
  }

  export function getFiles(): FileList | undefined {
    return files
  }

  export function setFiles(next: FileList | undefined): void {
    files = next
  }

  export function getValue(): File | File[] | null {
    return value
  }

  export function getRef(): HTMLInputElement | null {
    return el
  }

  export function getRefHistory(): ReadonlyArray<HTMLInputElement | null> {
    return history
  }
</script>

<form>
  {#if unbound}
    <FileInput
      ref={grab}
      {preview}
      {removeLabel}
      {...spreadAttrs}
      onchange={(e) => {
        const picked = Array.from(e.currentTarget.files ?? [])
        value = multiple ? picked : (picked[0] ?? null)
        rev += 1
        onPicked?.(undefined, e.currentTarget.files)
      }}
    />
  {:else}
    <FileInput
      bind:files
      ref={grab}
      {multiple}
      {preview}
      {removeLabel}
      {...attrs}
      onchange={(e) => onPicked?.(files, e.currentTarget.files)}
    />
  {/if}
</form>
