<script lang="ts">
  import { untrack } from 'svelte'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { checks, forms } from '#components/form/forms.config.js'
  import { Steps, useSteps } from '#components/steps/index.js'
  import { Attachment, Button } from '#components/ui/index.js'
  import {
    bindComponentForm,
    cancelComponentFormUpload,
    formatEntryUploadDescription,
    formatUploadBytesRu,
    isFormUploadProgress,
    type FormUploadProgress,
  } from '#hooks/component-form/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { UploadDemoValues } from './demo-schema.js'
  import {
    createUploadBundleForm,
    type StorageReport,
    type StorageTelemetrySnapshot,
    type UploadedDemoRecord,
  } from './forms.js'
  import UploadForecastBanner from './UploadForecastBanner.svelte'

  let {
    demo,
    onUploaded,
    onProgress,
  }: {
    demo: UploadDemoValues
    onUploaded: (
      created: readonly UploadedDemoRecord[],
      report?: StorageReport,
      telemetry?: StorageTelemetrySnapshot,
    ) => void
    onProgress: (progress: FormUploadProgress) => void
  } = $props()

  const initialDemo = untrack(() => demo)
  const formDesc = createUploadBundleForm(initialDemo)

  const upload = bindComponentForm(forms, formDesc, {
    checks,
    onSuccess: (res) => {
      const payload = res.data as
        | {
            item?: UploadedDemoRecord
            items?: readonly UploadedDemoRecord[]
            storageReport?: StorageReport
            telemetry?: StorageTelemetrySnapshot
          }
        | undefined
      const created = payload?.items ?? (payload?.item ? [payload.item] : [])
      if (created.length > 0) {
        onUploaded(created, payload?.storageReport, payload?.telemetry)
      }
    },
  })

  const selectedFiles = $derived.by((): readonly File[] => {
    const raw = upload.f.bundle?.value
    if (Array.isArray(raw)) {
      return raw.filter((item): item is File => item instanceof File && (item.size > 0 || item.name.length > 0))
    }
    if (raw instanceof File && (raw.size > 0 || raw.name.length > 0)) {
      return [raw]
    }
    return []
  })

  const activeProgress = $derived(
    isFormUploadProgress(upload.state.progress) ? upload.state.progress : null,
  )
  const selectedTotalBytes = $derived(selectedFiles.reduce((acc, f) => acc + f.size, 0))

  // Локальные шаги в памяти (`mode: 'local'`): URL страницы не мутируется при старте/отмене загрузки
  const steps = useSteps({
    owner: 'upload-demo-card',
    mode: 'local',
    steps: () => [
      { key: 'fill', label: 'Параметры загрузки', filled: true },
      { key: 'uploading', label: 'Активная загрузка', filled: upload.state.pending },
    ],
    current: () => 'fill',
  })

  $effect(() => {
    const targetStep = upload.state.pending && selectedFiles.length > 0 ? 'uploading' : 'fill'
    if (steps.currentKey !== targetStep) {
      steps.set(targetStep)
    }
  })

  $effect(() => {
    const p = upload.state.progress
    if (isFormUploadProgress(p)) {
      onProgress(p)
    }
  })
</script>

<Form form={upload} hiddenFields={upload.hidden()} enctype="multipart/form-data" class="space-y-4">
  <!--
    Поля формы остаются смонтированными в DOM на обоих шагах (`hidden` на шаге `uploading`),
    чтобы при нажатии «Отменить загрузку» или серверной ошибке введённые поля и выбранные в
    файловом поле (`Field`) вложения сохранялись на 100% без очистки.
  -->
  <div
    class={steps.currentKey === 'uploading' ? 'hidden' : 'space-y-4'}
    aria-hidden={steps.currentKey === 'uploading' ? 'true' : undefined}
    data-testid="upload-step-fill"
  >
    <Common errors={upload.common} />
    <div class="grid gap-4 sm:grid-cols-2">
      <Field of={upload.f.title} />
      <Field of={upload.f.custom_path} />
    </div>
    <Field of={upload.f.notes} />
    <Field of={upload.f.bundle} preview />
    <div class="grid gap-2 sm:grid-cols-2">
      <Field of={upload.f.allow_overwrite} />
      <Field of={upload.f.verify_integrity} />
    </div>
  </div>

  <Steps host={steps} label="Этапы отправки" nav={false}>
    {#snippet fill()}
      <div class="flex items-center gap-3">
        <Button type="submit" task={formTask(upload.state)} data-testid="submit-upload">
          Отправить в {demo.server}
        </Button>
      </div>
    {/snippet}

    {#snippet uploading()}
      <div class="space-y-4" data-testid="upload-step-active">
        <div class="space-y-2" data-testid="upload-active-attachments">
          {#each selectedFiles as file, idx (`${file.name}:${file.size}:${idx}`)}
            {@const entry =
              activeProgress?.files[idx] ??
              activeProgress?.files.find((e) => e.name === file.name && e.size === file.size)}
            <Attachment
              {file}
              state={entry?.state ?? 'uploading'}
              progress={entry?.progress ?? 0}
              description={entry
                ? formatEntryUploadDescription(entry)
                : `Подготовка · ${formatUploadBytesRu(file.size)}`}
            />
          {/each}
        </div>

        <UploadForecastBanner progress={activeProgress} totalBytes={selectedTotalBytes} />

        <div class="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onclick={() => cancelComponentFormUpload(upload)}
            data-testid="cancel-upload"
          >
            Отменить загрузку
          </Button>
        </div>
      </div>
    {/snippet}
  </Steps>
</Form>
