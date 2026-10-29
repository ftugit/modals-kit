<!--
  Прогноз оставшегося времени загрузки в минутах и контроль укладывания в лимит платформы.
  Размещается на шаге активной отправки строго между карточками `(Attachment)` и кнопкой `[Отменить загрузку]`.
-->
<script lang="ts">
  import {
    formatUploadBytesRu,
    formatUploadSpeedRu,
    predictUploadEta,
    type FormUploadProgress,
  } from '#hooks/component-form/index.js'

  let {
    progress,
    totalBytes,
  }: {
    progress: FormUploadProgress | null
    totalBytes: number
  } = $props()

  const forecast = $derived(
    predictUploadEta({
      phase: progress?.phase ?? 'validating',
      loadedBytes: progress?.sentBytes ?? 0,
      totalBytes: progress?.totalBytes ?? totalBytes,
      bytesPerSecond: progress?.bytesPerSecond ?? 0,
      elapsedMs: progress?.elapsedMs ?? 0,
      platform: progress?.platform ?? 'node',
      maxDurationMs: progress?.maxDurationMs ?? null,
      resumedCount: progress?.resumedCount ?? 0,
    }),
  )

  const requiredSpeedLabel = $derived(formatUploadSpeedRu(forecast.requiredBytesPerSecond))
</script>

<div
  role={forecast.willExceedLimit ? 'alert' : 'status'}
  aria-live="polite"
  data-testid="upload-forecast-banner"
  data-forecast-status={forecast.status}
  class={forecast.willExceedLimit
    ? 'rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs space-y-1.5'
    : 'rounded-lg border border-border bg-muted/40 p-3.5 text-xs space-y-1.5'}
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="font-medium text-foreground" data-testid="upload-forecast-eta">
      Прогноз загрузки: {forecast.remainingLabelRu}
    </div>
    <div class="flex flex-wrap items-center gap-2 text-muted-foreground">
      {#if forecast.speedLabelRu}
        <span class="font-mono font-medium text-foreground" data-testid="upload-forecast-speed">
          {forecast.speedLabelRu}
        </span>
      {/if}
      {#if progress}
        <span>
          {formatUploadBytesRu(progress.sentBytes)} из {formatUploadBytesRu(progress.totalBytes)}
        </span>
      {/if}
      {#if (progress?.resumedCount ?? 0) > 0}
        <span
          class="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
          data-testid="upload-autoresume-badge"
        >
          авто-дозагрузка ×{progress?.resumedCount}
        </span>
      {/if}
    </div>
  </div>

  <div class="text-muted-foreground" data-testid="upload-forecast-platform">
    Платформа: {forecast.platformLabelRu}
  </div>

  {#if forecast.willExceedLimit && forecast.warningTextRu}
    <p class="font-medium text-destructive leading-relaxed" data-testid="upload-limit-warning">
      {forecast.warningTextRu}
      {#if requiredSpeedLabel}
        <span class="font-normal"> (нужно не менее {requiredSpeedLabel})</span>
      {/if}
    </p>
  {/if}
</div>
