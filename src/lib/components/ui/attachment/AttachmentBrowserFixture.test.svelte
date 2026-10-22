<script lang="ts">
  import Attachment from './Attachment.svelte'
  import AttachmentAction from './AttachmentAction.svelte'
  import type { AttachmentItem, AttachmentKind } from './model'

  // Real 1x1 solid sky-blue PNG (valid IHDR + IDAT + IEND) for genuine Blink decode
  const PNG_1X1 = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4cfPmfQAJAgN78S683AAAAABJRU5ErkJggg==',
    ),
    (c) => c.charCodeAt(0),
  )

  const kinds: Array<{ kind: AttachmentKind; filename: string; mimeType: string }> = [
    { kind: 'document', filename: 'very_long_unbroken_attachment_filename_2026_final_v12_signed.pdf', mimeType: 'application/pdf' },
    { kind: 'image', filename: 'poster.webp', mimeType: 'image/webp' },
    { kind: 'video', filename: 'demo.mp4', mimeType: 'video/mp4' },
    { kind: 'audio', filename: 'voice.ogg', mimeType: 'audio/ogg' },
    { kind: 'archive', filename: 'backup.tar.gz', mimeType: 'application/gzip' },
    { kind: 'code', filename: 'schema.ts', mimeType: 'application/typescript' },
    { kind: 'file', filename: 'raw-payload.bin', mimeType: 'application/octet-stream' },
  ]

  const radioItems: AttachmentItem[] = [
    { id: 'cov-1', filename: 'cover-first.png', byteSize: 49_152, mimeType: 'image/png' },
    { id: 'cov-2', filename: 'cover-second.png', byteSize: 73_728, mimeType: 'image/png' },
    { id: 'cov-3', filename: 'cover-third.png', byteSize: 32_768, mimeType: 'image/png' },
  ]

  const checkItems: AttachmentItem[] = [
    { id: 'att-1', filename: 'invoice-q1.pdf', byteSize: 128_000, mimeType: 'application/pdf' },
    { id: 'att-2', filename: 'invoice-q2.pdf', byteSize: 256_000, mimeType: 'application/pdf' },
    { id: 'att-3', filename: 'locked-ledger.pdf', byteSize: 64_000, mimeType: 'application/pdf' },
  ]

  let liveFile = $state<File | undefined>(
    new File([PNG_1X1], 'local-shot-1.png', { type: 'image/png' }),
  )
  let selectedCover = $state<string | undefined>('cov-1')
  let selectedDocs = $state<string[]>(['att-1'])
  let openLog = $state<string[]>([])
  let actionLog = $state<string[]>([])

  export function swapToSecondPng() {
    liveFile = new File([PNG_1X1], 'local-shot-2.png', { type: 'image/png' })
  }
  export function swapToCorruptPng() {
    liveFile = new File([new Uint8Array([1, 2, 3, 4, 5])], 'corrupt.png', { type: 'image/png' })
  }
  export function snapshot() {
    return {
      selectedCover,
      selectedDocs: [...selectedDocs],
      openLog: [...openLog],
      actionLog: [...actionLog],
    }
  }
</script>

<section data-testid="attachment-e2e-root" class="flex w-full max-w-full flex-col gap-6 py-4">
  <div data-testid="live-file-box" class="flex flex-wrap gap-3">
    <Attachment
      file={liveFile}
      layout="tile"
      size="md"
      alt="Локальное превью"
      onOpen={() => openLog.push('live-open')}
    >
      {#snippet actions({ item })}
        <AttachmentAction
          aria-label={`Удалить ${item.label}`}
          onclick={() => actionLog.push(`del:${item.filename}`)}
        >
          ×
        </AttachmentAction>
      {/snippet}
    </Attachment>

    <Attachment
      filename="hidden-meta-tile.pdf"
      byteSize={16_384}
      layout="tile"
      size="sm"
      showFilename={false}
      showSize={false}
      selection="multiple"
      name="compact"
      value="compact-1"
    />
  </div>

  <div data-testid="sizes-and-kinds" class="flex flex-col gap-2">
    <Attachment filename="small-row.pdf" byteSize={4096} size="sm" state="idle" />
    <Attachment
      filename="uploading-strip.mp4"
      byteSize={10_485_760}
      size="md"
      state="uploading"
      progress={68}
      progressVariant="strip"
    />
    <Attachment
      filename="processing-bg.csv"
      byteSize={524_288}
      size="lg"
      state="processing"
      progressVariant="background"
    />
    <Attachment
      filename="too-large.png"
      byteSize={25_165_824}
      state="error"
      error="Превышен максимальный размер 10 МиБ"
    />
    {#each kinds as entry (entry.kind)}
      <Attachment
        filename={entry.filename}
        mimeType={entry.mimeType}
        byteSize={8192}
      />
    {/each}
  </div>

  <form data-testid="browser-selection-form" class="flex flex-col gap-4">
    <div data-testid="browser-single-group" class="flex flex-col gap-2">
      {#each radioItems as item (item.id)}
        <Attachment
          {item}
          selection="single"
          name="cover"
          bind:selectedValue={selectedCover}
          onOpen={() => openLog.push(item.id)}
        >
          {#snippet actions({ item: norm })}
            <AttachmentAction
              aria-label={`Удалить ${norm.label}`}
              onclick={() => actionLog.push(item.id)}
            >
              ×
            </AttachmentAction>
          {/snippet}
        </Attachment>
      {/each}
    </div>

    <div data-testid="browser-multi-group" class="flex flex-wrap gap-3">
      {#each checkItems as item (item.id)}
        <Attachment
          {item}
          layout="tile"
          size="md"
          selection="multiple"
          name="docs"
          disabled={item.id === 'att-3'}
          bind:selectedValues={selectedDocs}
          onOpen={() => openLog.push(item.id)}
        >
          {#snippet actions({ item: norm, disabled })}
            <AttachmentAction
              aria-label={`Удалить ${norm.label}`}
              {disabled}
              onclick={() => actionLog.push(item.id)}
            >
              ×
            </AttachmentAction>
          {/snippet}
        </Attachment>
      {/each}
    </div>
  </form>
</section>
