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
  import CloneServerButton from './CloneServerButton.svelte'
  import CopyUploadButton from './CopyUploadButton.svelte'
  import {
    createUploadDemoPanelSchema,
    type UploadDemoValues,
  } from './demo-schema.js'
  import DownloadInspector from './DownloadInspector.svelte'
  import {
    quickNoteForm,
    type QuickNoteRecord,
    type StorageCloneReport,
    type StorageReport,
    type StorageTelemetrySnapshot,
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
  let localTelemetry = $state<StorageTelemetrySnapshot | null>(null)
  let lastProgress = $state<FormUploadProgress | null>(null)

  // При инвалидации `load` (например после добавления сервера в куки-сейфе) синхронизируем отчёт
  $effect(() => {
    void data.storageReport
    localReport = null
    localTelemetry = null
    localItems = null
  })

  const items = $derived(localItems ?? data.items)
  const notes = $derived(localNotes ?? data.notes)
  const storageReport = $derived(localReport ?? data.storageReport)
  const telemetry = $derived(localTelemetry ?? data.telemetry)
  const formShapeKey = $derived(
    `${demo.server}:${demo.write_strategy}:${demo.stage_to_disk}:${demo.max_mb}:${demo.accept}:${demo.multiple}:${demo.integrity}`,
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
    nextTelemetry?: StorageTelemetrySnapshot,
  ): void {
    const existing = localItems ?? data.items
    const createdIds = new Set(created.map((c) => c.id))
    localItems = [...created, ...existing.filter((x) => !createdIds.has(x.id))]
    if (report) localReport = report
    if (nextTelemetry) localTelemetry = nextTelemetry
  }

  function handleItemUpdated(
    updated: UploadedDemoRecord,
    report?: StorageReport,
    nextTelemetry?: StorageTelemetrySnapshot,
  ): void {
    localItems = (localItems ?? data.items).map((item) =>
      item.id === updated.id ? updated : item,
    )
    if (report) localReport = report
    if (nextTelemetry) localTelemetry = nextTelemetry
  }

  function handleCloned(
    _cloneReport: StorageCloneReport,
    nextItems?: readonly UploadedDemoRecord[],
    report?: StorageReport,
    nextTelemetry?: StorageTelemetrySnapshot,
  ): void {
    if (nextItems) localItems = nextItems
    if (report) localReport = report
    if (nextTelemetry) localTelemetry = nextTelemetry
  }

  function handleRemoved(removedId: string): void {
    localItems = (localItems ?? data.items).filter((item) => item.id !== removedId)
  }

  function buildFileHref(
    item: UploadedDemoRecord,
    mode: 'attachment' | 'inline',
    explicitServer?: string,
  ): string {
    const base = item.url.split('?')[0] ?? `/api/files/${item.path}`
    const params = new URLSearchParams()
    const isMultiPart = (item.partsCount ?? 1) > 1
    if (explicitServer) {
      params.set('server', explicitServer)
    } else if (!isMultiPart && item.server && item.server !== 'local') {
      params.set('server', item.server)
    }
    if (mode === 'attachment') {
      params.set('download', '1')
      params.set('name', item.filename)
    }
    if (demo.dl_rate !== 'default') {
      params.set('rate', demo.dl_rate)
    }
    if (demo.dl_concurrency !== 'default') {
      params.set('concurrency', demo.dl_concurrency)
    }
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
  }
</script>

<svelte:head>
  <title>Потоковая загрузка и мультисерверное хранилище — modals-kit</title>
</svelte:head>

<div class="mx-auto w-full max-w-4xl space-y-6">
  <header class="space-y-2">
    <h1 class="text-3xl font-semibold tracking-tight">
      Потоковая загрузка (<code>wss://</code>) и мультисерверное хранилище (<code>#lib/storage</code>)
    </h1>
    <p class="text-muted-foreground">
      Полный стенд загрузки, нарезки (<code>split</code>) и потокового скачивания (<code>serve</code>):
      Кадр 0 проверяет поля и ACL, сегменты по 256 КБ пишутся без буферизации в ОЗУ, а скачивание
      поддерживает <code>Range 206</code> поперёк стыка зашифрованных серверов, RFC 5987 имена,
      шейпер полосы <code>rate</code> и семафоры потоков <code>concurrency</code>.
    </p>
  </header>

  {#key panelShapeKey}
    <DemoPanel
      schema={panelSchema}
      vault={{
        modal: STORAGE_VAULT_MODAL,
        href: STORAGE_VAULT_ROUTE,
        label: 'Куки-сейф S3 / WebDAV',
        count: data.vaultSnapshot.items.length,
      }}
      onParams={(p) => (demo = p as UploadDemoValues)}
    >
      {#snippet footer()}
        <p>
          Подключённые серверы:
          <code class="rounded bg-muted/70 px-1" data-testid="connected-servers">
            {data.availableServers.join(', ')}
          </code>.
          Ключи S3 и WebDAV хранятся только в зашифрованных <code>HttpOnly</code>-куках браузера
          (<code>dv_key</code> + <code>dv_storage_*</code>) — <code>0</code> переменных в <code>.env</code> и БД.
        </p>
      {/snippet}
    </DemoPanel>
  {/key}

  <section
    class="rounded-xl border border-border bg-muted/25 px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3"
    aria-label="Телеметрия потоков хранилища"
    data-testid="storage-telemetry"
  >
    <div class="flex flex-wrap items-center gap-3">
      <span class="font-semibold">Телеметрия <code>#lib/storage/state.js</code>:</span>
      <span>активных загрузок: <strong>{telemetry.activeUploads}</strong></span> ·
      <span>активных скачиваний: <strong>{telemetry.activeDownloads}</strong></span> ·
      <span>записано: <strong>{formatBytes(telemetry.bytesWritten)}</strong></span> ·
      <span>отдано: <strong>{formatBytes(telemetry.bytesRead)}</strong></span> ·
      <span>ошибок: <strong>{telemetry.errorsCount}</strong></span>
    </div>
  </section>

  <section
    class="grid gap-3 sm:grid-cols-2"
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
          <div class="flex flex-wrap items-center gap-1">
            <span
              class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                srv.healthy
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-destructive/15 text-destructive'
              }`}
              data-testid={`server-health-${srv.server}`}
            >
              {srv.healthy ? 'healthy' : 'cooldown'}
            </span>
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
          Занято: <strong>{formatBytes(srv.usedBytes)}</strong> ·
          в брони: <strong>{formatBytes(srv.reservedBytes)}</strong> ·
          файлов: <strong>{srv.filesCount}</strong> ·
          частей: <strong>{srv.partsCount}</strong>
        </div>
        <div class="text-muted-foreground">
          Лимит: {srv.limits.storageBytes ? formatBytes(srv.limits.storageBytes) : '∞'}
          (файл до {srv.limits.fileBytes ? formatBytes(srv.limits.fileBytes) : '∞'})
        </div>
        <div class="flex flex-wrap items-start gap-2 pt-1">
          <ProbeServerButton
            serverName={srv.server}
            onProbed={(_probe, nextReport) => {
              if (nextReport) localReport = nextReport
            }}
          />
          {#if srv.filesCount > 0 && srv.server !== 'memory'}
            <CloneServerButton
              fromServer={srv.server}
              toServer="memory"
              onCloned={handleCloned}
            />
          {/if}
        </div>
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
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="uploaded-list-heading" class="text-xl font-semibold">
        Загруженные файлы и проверка скачивания ({items.length})
      </h2>
      <span class="text-xs text-muted-foreground">
        Режим ссылок: <code>{demo.dl_mode}</code> ·
        rate: <code>{demo.dl_rate}</code> ·
        concurrency: <code>{demo.dl_concurrency}</code>
      </span>
    </div>

    {#if items.length === 0}
      <p class="text-sm text-muted-foreground" data-testid="empty-uploads">Файлов пока нет.</p>
    {:else}
      <ul class="space-y-3" data-testid="uploaded-list">
        {#each items as item (item.id)}
          {@const copyTargets = data.availableServers.filter(
            (s) =>
              s !== item.server &&
              s !== 'shard_a' &&
              s !== 'shard_b' &&
              !(item.replicas ?? []).includes(s),
          )}
          {@const moveTargets = data.availableServers.filter(
            (s) => s !== item.server && s !== 'shard_a' && s !== 'shard_b',
          )}
          <li
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5 text-sm"
            data-testid="uploaded-item"
            data-transport={item.transport}
            data-server={item.server}
            data-parts={item.partsCount ?? 1}
          >
            <div class="space-y-1 min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium">{item.title}</span>
                <code class="rounded bg-muted px-1.5 py-0.5 text-[11px]">{item.path}</code>
                {#if item.encrypted}
                  <span
                    class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                    data-testid="uploaded-encrypted"
                  >
                    AES-256-GCM
                  </span>
                {/if}
                {#if (item.partsCount ?? 1) > 1}
                  <span
                    class="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                    data-testid="uploaded-split-badge"
                  >
                    split: {item.partsCount} ч. ({(item.partServers ?? [item.server]).join(' + ')})
                  </span>
                {/if}
              </div>

              <div class="text-xs text-muted-foreground">
                <span>{item.filename}</span> ·
                <span>открытый вес: <strong>{formatBytes(item.size)}</strong></span>
                {#if item.storedBytes !== undefined && item.storedBytes !== item.size}
                  · <span>на диске/облаке: <strong>{formatBytes(item.storedBytes)}</strong></span>
                {/if}
                · <span>сервер: <strong data-testid="uploaded-server">{item.server}</strong></span>
                {#if item.replicas && item.replicas.length > 0}
                  · <span data-testid="uploaded-replicas">реплики: <strong>{item.replicas.join(', ')}</strong></span>
                {/if}
                · <span>транспорт: <strong data-testid="uploaded-transport">{item.transport}</strong></span>
                {#if item.integrityVerified}
                  · <span data-testid="uploaded-integrity">соль + HMAC-SHA-256</span>
                {/if}
              </div>
              {#if item.notes}
                <p class="text-xs text-muted-foreground">{item.notes}</p>
              {/if}
            </div>

            <div class="flex flex-wrap items-center gap-2">
              {#each copyTargets as copySrv (copySrv)}
                <CopyUploadButton
                  itemId={item.id}
                  targetServer={copySrv}
                  onCopied={(upd, rep, tel) => handleItemUpdated(upd, rep, tel)}
                />
              {/each}
              {#each moveTargets as otherServer (otherServer)}
                <TransferUploadButton
                  itemId={item.id}
                  targetServer={otherServer}
                  onTransferred={(upd, rep) => handleItemUpdated(upd, rep)}
                />
              {/each}
              <a
                href={buildFileHref(item, 'attachment')}
                download={item.filename}
                class="text-sm font-medium underline underline-offset-4 hover:text-primary"
                data-testid="download-link"
              >
                Скачать
              </a>
              <a
                href={buildFileHref(item, 'inline')}
                target="_blank"
                rel="noreferrer"
                class="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-primary"
                data-testid="inline-link"
              >
                Inline
              </a>
              {#if item.replicas && item.replicas.length > 0}
                {#each item.replicas as repSrv (repSrv)}
                  <a
                    href={buildFileHref(item, 'attachment', repSrv)}
                    download={item.filename}
                    class="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-primary"
                    data-testid={`download-replica-${repSrv}`}
                  >
                    Скачать с {repSrv}
                  </a>
                {/each}
              {/if}
              <RemoveUploadButton itemId={item.id} onRemoved={handleRemoved} />
            </div>

            <DownloadInspector {item} {demo} />
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
