<script lang="ts">
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm, type FormUploadProgress } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { PageData } from './$types'
  import {
    quickNoteForm,
    uploadBundleForm,
    type QuickNoteRecord,
    type UploadedDemoRecord,
  } from './forms.js'
  import RemoveUploadButton from './RemoveUploadButton.svelte'

  let { data }: { data: PageData } = $props()

  let localItems = $state<readonly UploadedDemoRecord[] | null>(null)
  let localNotes = $state<readonly QuickNoteRecord[] | null>(null)
  let lastProgress = $state<FormUploadProgress | null>(null)

  const items = $derived(localItems ?? data.items)
  const notes = $derived(localNotes ?? data.notes)

  const upload = bindComponentForm(forms, uploadBundleForm, {
    onSuccess: (res) => {
      const created = (res.data as { item?: UploadedDemoRecord } | undefined)?.item
      if (created) {
        localItems = [created, ...(localItems ?? data.items)]
      }
    },
  })

  const quickNote = bindComponentForm(forms, quickNoteForm, {
    onSuccess: (res) => {
      const created = (res.data as { note?: QuickNoteRecord } | undefined)?.note
      if (created) {
        localNotes = [created, ...(localNotes ?? data.notes)]
      }
    },
  })

  function handleRemoved(removedId: string): void {
    localItems = (localItems ?? data.items).filter((item) => item.id !== removedId)
  }

  $effect(() => {
    const p = upload.state.progress
    if (
      p &&
      typeof p === 'object' &&
      (p as { kind?: unknown }).kind === 'ws-upload'
    ) {
      lastProgress = p as FormUploadProgress
    }
  })

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
    return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`
  }
</script>

<svelte:head>
  <title>Потоковая загрузка файлов — modals-kit</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-8">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">
      Потоковая загрузка файлов (<code>wss://</code>)
    </h1>
    <p class="text-muted-foreground">
      Кадр 0 отправляет и валидирует поля формы до чтения байтов файла, затем сервер вытягивает
      сегменты по 256 КБ по одному закреплённому WebSocket-соединению и атомарно собирает их в
      <code>#lib/storage</code>.
    </p>
  </header>

  <section class="rounded-xl border border-border bg-card p-6 space-y-4" aria-labelledby="ws-upload-heading">
    <h2 id="ws-upload-heading" class="text-xl font-semibold">
      Форма с файлом (<code>wss://</code> + no-JS fallback)
    </h2>

    <Form form={upload} hiddenFields={upload.hidden()} enctype="multipart/form-data" class="space-y-4">
      <Common errors={upload.common} />
      <Field of={upload.f.title} />
      <Field of={upload.f.notes} />
      <Field of={upload.f.bundle} preview />

      <div class="flex items-center gap-3">
        <Button type="submit" task={formTask(upload.state)} data-testid="submit-upload">
          Отправить файл
        </Button>
      </div>
    </Form>

    {#if lastProgress}
      <div
        class="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1"
        data-testid="ws-progress-log"
        data-phase={lastProgress.phase}
      >
        <div class="font-medium">
          Статус потока: <span data-testid="ws-phase">{lastProgress.phase}</span> ·
          {lastProgress.percent}% ({formatBytes(lastProgress.sentBytes)} из {formatBytes(lastProgress.totalBytes)})
        </div>
        {#each lastProgress.files as fEntry (fEntry.fileId)}
          <div data-testid="ws-file-summary">
            {fEntry.name}: сегментов {fEntry.sentSegments}/{fEntry.totalSegments}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="rounded-xl border border-border bg-card p-6 space-y-4" aria-labelledby="uploaded-list-heading">
    <h2 id="uploaded-list-heading" class="text-xl font-semibold">Загруженные файлы ({items.length})</h2>

    {#if items.length === 0}
      <p class="text-sm text-muted-foreground" data-testid="empty-uploads">Файлов пока нет.</p>
    {:else}
      <ul class="space-y-3" data-testid="uploaded-list">
        {#each items as item (item.id)}
          <li
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            data-testid="uploaded-item"
            data-transport={item.transport}
          >
            <div class="space-y-0.5">
              <div class="font-medium">{item.title}</div>
              <div class="text-xs text-muted-foreground">
                <span>{item.filename}</span> ·
                <span>{formatBytes(item.size)}</span> ·
                <span>транспорт: <strong data-testid="uploaded-transport">{item.transport}</strong></span>
              </div>
              {#if item.notes}
                <p class="text-xs text-muted-foreground">{item.notes}</p>
              {/if}
            </div>

            <div class="flex items-center gap-3">
              <a
                href={`${item.url}?download=1`}
                download={item.filename}
                class="text-sm font-medium underline underline-offset-4 hover:text-primary"
                data-testid="download-link"
              >
                Скачать
              </a>
              <RemoveUploadButton itemId={item.id} onRemoved={handleRemoved} />
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="rounded-xl border border-border bg-card p-6 space-y-4" aria-labelledby="http-note-heading">
    <h2 id="http-note-heading" class="text-xl font-semibold">
      Контроль: форма без файла (штатный HTTP <code>fetch</code>)
    </h2>

    <Form form={quickNote} hiddenFields={quickNote.hidden()} class="flex flex-wrap items-end gap-3">
      <div class="flex-1 min-w-60">
        <Field of={quickNote.f.message} />
      </div>
      <Button type="submit" variant="secondary" task={formTask(quickNote.state)} data-testid="submit-note">
        Сохранить заметку
      </Button>
    </Form>

    {#if notes.length > 0}
      <ul class="space-y-1 text-sm" data-testid="notes-list">
        {#each notes as n (n.id)}
          <li class="rounded border border-border px-3 py-1.5" data-testid="note-item">{n.message}</li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
