<script lang="ts">
  import { untrack } from 'svelte'
  import { DemoPanel } from '#components/demo/index.js'
  import { demoParams } from '#components/demo/schema.js'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import {
    STORAGE_VAULT_MODAL,
    STORAGE_VAULT_ROUTE,
  } from '#content/storage-vault/modals.js'
  import { bindComponentForm, type FormUploadProgress } from '#hooks/component-form/index.js'
  import { visibleAddress } from '#lib/address/sveltekit.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { PageData } from './$types'
  import {
    createUploadDemoPanelSchema,
    type UploadDemoValues,
  } from './demo-schema.js'
  import {
    quickNoteForm,
    type QuickNoteRecord,
    type StorageReport,
    type UploadedDemoRecord,
  } from './forms.js'
  import ProbeServerButton from './ProbeServerButton.svelte'
  import RemoveUploadButton from './RemoveUploadButton.svelte'
  import TransferUploadButton from './TransferUploadButton.svelte'
  import UploadFormCard from './UploadFormCard.svelte'

  let { data }: { data: PageData } = $props()

  const panelSchema = $derived(
    createUploadDemoPanelSchema(
      data.vaultSnapshot.items.map((x) => ({ id: x.id, summary: x.summary })),
    ),
  )

  const initialDemo = untrack(
    () => demoParams(panelSchema, visibleAddress().url) as UploadDemoValues,
  )
  let demo = $state<UploadDemoValues>(initialDemo)

  let localItems = $state<readonly UploadedDemoRecord[] | null>(null)
  let localNotes = $state<readonly QuickNoteRecord[] | null>(null)
  let localReport = $state<StorageReport | null>(null)
  let lastProgress = $state<FormUploadProgress | null>(null)

  // При инвалидации `load` (например после добавления сервера в куки-сейфе) синхронизируем отчёт
  $effect(() => {
    void data.storageReport
    localReport = null
  })

  const items = $derived(localItems ?? data.items)
  const notes = $derived(localNotes ?? data.notes)
  const storageReport = $derived(localReport ?? data.storageReport)
  const formShapeKey = $derived(
    `${demo.max_mb}:${demo.accept}:${demo.multiple}:${demo.integrity}`,
  )
  const panelShapeKey = $derived(data.vaultSnapshot.items.map((x) => x.id).join(','))

  const quickNote = bindComponentForm(forms, quickNoteForm, {
    onSuccess: (res) => {
      const created = (res.data as { note?: QuickNoteRecord } | undefined)?.note
      if (created) {
        localNotes = [created, ...(localNotes ?? data.notes)]
      }
    },
  })

  function handleUploaded(
    created: readonly UploadedDemoRecord[],
    report?: StorageReport,
  ): void {
    localItems = [...created, ...(localItems ?? data.items)]
    if (report) localReport = report
  }

  function handleTransferred(
    updated: UploadedDemoRecord,
    report?: StorageReport,
  ): void {
    localItems = (localItems ?? data.items).map((item) =>
      item.id === updated.id ? updated : item,
    )
    if (report) localReport = report
  }

  function handleRemoved(removedId: string): void {
    localItems = (localItems ?? data.items).filter((item) => item.id !== removedId)
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
  }
</script>

<svelte:head>
  <title>Потоковая загрузка и S3 — modals-kit</title>
</svelte:head>

<div class="mx-auto w-full max-w-4xl space-y-6">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">
      Потоковая загрузка (<code>wss://</code>) и мультисерверный S3 (<code>#lib/storage</code>)
    </h1>
    <p class="text-muted-foreground">
      Кадр 0 проверяет поля, лимиты и ACL до чтения байтов файла, после чего поток сегментами
      по 256 КБ уходит напрямую в выбранное хранилище (<code>local</code>, <code>memory</code>,
      <code>auto</code> или любой S3 из вашего зашифрованного куки-сейфа) без хранения ключей в <code>.env</code> или БД.
    </p>
  </header>

  {#key panelShapeKey}
    <DemoPanel
      schema={panelSchema}
      vault={{
        modal: STORAGE_VAULT_MODAL,
        href: STORAGE_VAULT_ROUTE,
        label: 'Куки-сейф S3',
        count: data.vaultSnapshot.items.length,
      }}
      onParams={(p) => (demo = p as UploadDemoValues)}
    >
      {#snippet footer()}
        <p>
          Подключённые хранилища сессии:
          <code class="rounded bg-muted/70 px-1" data-testid="connected-servers">
            {data.availableServers.join(', ')}
          </code>.
          S3-ключи хранятся в зашифрованных <code>HttpOnly</code>-куках браузера (<code>dv_key</code> + <code>dv_storage_*</code>)
          и доступны как в модалке, так и по прямому маршруту без JS.
        </p>
      {/snippet}
    </DemoPanel>
  {/key}

  <section
    class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    aria-label="Состояние серверов хранения"
    data-testid="storage-report"
  >
    {#each storageReport.servers as srv (srv.server)}
      <div
        class="rounded-xl border border-border bg-card p-4 text-xs space-y-1.5"
        data-testid={`server-card-${srv.server}`}
      >
        <div class="flex items-center justify-between font-semibold text-sm">
          <span>{srv.server}</span>
          <div class="flex items-center gap-1">
            {#if srv.encrypted}
              <span
                class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                data-testid={`server-encrypted-${srv.server}`}
              >
                AES-256-GCM
              </span>
            {/if}
            {#if srv.readOnly}
              <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                readOnly
              </span>
            {/if}
            <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{srv.kind}</span>
          </div>
        </div>
        <div class="text-muted-foreground">
          Занято: <strong>{formatBytes(srv.usedBytes)}</strong> · файлов: <strong>{srv.filesCount}</strong>
        </div>
        <div class="text-muted-foreground">
          Лимит: {srv.limits.storageBytes ? formatBytes(srv.limits.storageBytes) : '∞'}
          (файл до {srv.limits.fileBytes ? formatBytes(srv.limits.fileBytes) : '∞'})
        </div>
        <ProbeServerButton
          serverName={srv.server}
          onProbed={(_probe, nextReport) => {
            if (nextReport) localReport = nextReport
          }}
        />
      </div>
    {/each}
  </section>

  <section class="rounded-xl border border-border bg-card p-6 space-y-4" aria-labelledby="ws-upload-heading">
    <h2 id="ws-upload-heading" class="text-xl font-semibold">
      Форма с файлом (<code>wss://</code> → <code>{demo.server}</code> + no-JS fallback)
    </h2>

    {#key formShapeKey}
      <UploadFormCard
        {demo}
        onUploaded={handleUploaded}
        onProgress={(p) => (lastProgress = p)}
      />
    {/key}

    {#if lastProgress}
      <div
        class="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1"
        data-testid="ws-progress-log"
        data-phase={lastProgress.phase}
        data-salted={lastProgress.salted ? 'true' : 'false'}
      >
        <div class="font-medium">
          Статус потока: <span data-testid="ws-phase">{lastProgress.phase}</span> ·
          {lastProgress.percent}% ({formatBytes(lastProgress.sentBytes)} из {formatBytes(lastProgress.totalBytes)})
          {#if lastProgress.salted}
            · <span data-testid="ws-hmac-badge">HMAC-SHA-256 (с солью)</span>
          {/if}
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
    <h2 id="uploaded-list-heading" class="text-xl font-semibold">
      Загруженные файлы ({items.length})
    </h2>

    {#if items.length === 0}
      <p class="text-sm text-muted-foreground" data-testid="empty-uploads">Файлов пока нет.</p>
    {:else}
      <ul class="space-y-3" data-testid="uploaded-list">
        {#each items as item (item.id)}
          <li
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            data-testid="uploaded-item"
            data-transport={item.transport}
            data-server={item.server}
          >
            <div class="space-y-0.5">
              <div class="font-medium">{item.title}</div>
              <div class="text-xs text-muted-foreground">
                <span>{item.filename}</span> ·
                <span>{formatBytes(item.size)}</span> ·
                <span>сервер: <strong data-testid="uploaded-server">{item.server}</strong></span> ·
                <span>транспорт: <strong data-testid="uploaded-transport">{item.transport}</strong></span>
                {#if item.integrityVerified}
                  · <span data-testid="uploaded-integrity">соль + HMAC-SHA-256</span>
                {/if}
              </div>
              {#if item.notes}
                <p class="text-xs text-muted-foreground">{item.notes}</p>
              {/if}
            </div>

            <div class="flex flex-wrap items-center gap-2">
              {#each data.availableServers.filter((s) => s !== item.server) as otherServer (otherServer)}
                <TransferUploadButton
                  itemId={item.id}
                  targetServer={otherServer}
                  onTransferred={handleTransferred}
                />
              {/each}
              <a
                href={`${item.url}${item.url.includes('?') ? '&' : '?'}download=1`}
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
      <Common errors={quickNote.common} />
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
