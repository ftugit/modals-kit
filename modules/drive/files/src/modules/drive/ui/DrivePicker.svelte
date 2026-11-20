<script lang="ts">
  /**
   * Пикер файлов: тот же список диска, но строка возвращает id вызывающему
   * экрану, а не открывает карточку.
   *
   * Контракт адреса: `from` (локальный адрес возврата), `param` (какой
   * query-параметр заполнить), `kind` (`folder` — только папки), `folder`
   * (текущая папка пикера), `mode` (`single`/`multiple`), `upicks` (`chosen`)
   * и `picked` — накопительный набор шага `pick`.
   *
   * `single` атомарен: кнопки выбора сразу уходят в `from`. `multiple` живёт
   * на шагах `pick`/`chosen`; шаг и отметки — GET-ссылки, поэтому контракт
   * работает без JS, а `drive.ids` собирается из `picked` на шаге `chosen`.
   */
  import { Button, Empty } from '#core/ui/index.js'
  import type { DrivePickerData } from '../types.js'
  import { applyHref, canApplyChosen } from '../picker.js'
  import {
    EMPTY_DRIVE_PICKER_FILTERS,
    type DrivePickerFilters,
    type DrivePickerState,
    pickerHref,
  } from '../picker-url.js'
  import DriveBrowse from './DriveBrowse.svelte'

  interface Props {
    initial: DrivePickerData
    onPick?: ((id: string | null, label: string) => void) | null
    onPicked?: ((ids: readonly string[], labels: readonly string[]) => void) | null
    onCancel?: (() => void) | null
  }

  let { initial, onPick = null, onPicked = null, onCancel = null }: Props = $props()

  const text = (extra: Record<string, unknown>, key: string): string | null =>
    typeof extra[key] === 'string' ? String(extra[key]) : null

  const filters = $derived.by<DrivePickerFilters>(() => {
    const extra = (initial.list.snapshot?.extra ?? {}) as Record<string, unknown>
    const type = extra.type
    return {
      q: text(extra, 'q'),
      type: type === 'file' || type === 'folder' ? type : 'all',
      from: text(extra, 'from'),
      to: text(extra, 'to'),
    }
  })

  const state = $derived<DrivePickerState>({
    from: initial.from,
    param: initial.param,
    kind: initial.kind,
    folderId: initial.folderId,
    mode: initial.mode,
    step: initial.step,
    picked: initial.picked,
    filters,
    filterOwner: initial.filterOwner,
  })

  const multiple = $derived(initial.mode === 'multiple')
  const hasOwnFilters = $derived(
    Boolean(filters.q) || filters.type !== 'all' || Boolean(filters.from) || Boolean(filters.to),
  )
  const pickedCount = $derived(initial.picked.length)
  const canApply = $derived(
    canApplyChosen({
      pickedCount,
      totalItems: initial.totalItems,
      hiddenCount: initial.hiddenCount,
    }),
  )

  const href = (patch: Parameters<typeof pickerHref>[1]): string => pickerHref(state, patch)

  const applyTarget = $derived(
    applyHref(initial.from, initial.param, { mode: 'multiple', ids: initial.picked }),
  )

  const toggle = (id: string): readonly string[] =>
    initial.picked.includes(id)
      ? initial.picked.filter((item) => item !== id)
      : pickedCount >= 100
        ? initial.picked
        : [...initial.picked, id]

  const picker = $derived({
    from: initial.from,
    param: initial.param,
    kind: initial.kind,
    folderId: initial.folderId,
    mode: initial.mode,
    step: initial.step,
    picked: initial.picked,
    hiddenCount: initial.hiddenCount,
    href,
  })
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
  {#if multiple}
    <nav aria-label="Шаги выбора" class="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      {#if initial.step === 'chosen'}
        <Button href={href({ step: 'pick', filterOwner: 'chosen' })} variant="link" size="sm">← К выбору</Button>
      {:else}
        <span class="text-muted-foreground" aria-current="step">Выбор файлов и папок</span>
      {/if}
      <span aria-hidden="true" class="text-muted-foreground">/</span>
      {#if initial.step === 'chosen'}
        <span class="text-muted-foreground" aria-current="step">Выбранные ({pickedCount})</span>
      {:else if pickedCount > 0}
        <Button href={href({ step: 'chosen' })} variant="link" size="sm">Выбранные ({pickedCount})</Button>
      {:else}
        <span class="text-muted-foreground">Выбранные (0)</span>
      {/if}
    </nav>
  {/if}

  {#if multiple && initial.step === 'chosen' && hasOwnFilters}
    <div>
      <Button href={href({ filters: EMPTY_DRIVE_PICKER_FILTERS })} variant="outline" size="sm" data-testid="drive-picker-reset-filters">
        Сбросить фильтры
      </Button>
    </div>
  {/if}

  {#if multiple && initial.step === 'chosen' && initial.hiddenCount !== null && initial.hiddenCount > 0}
    <p class="text-sm text-muted-foreground" role="status" data-testid="drive-picker-hidden">
      Часть выбранных ({initial.hiddenCount}) недоступна в текущей папке или скрыта фильтром:
      применить набор нельзя, пока он не виден целиком.
    </p>
  {/if}

  <DriveBrowse
    initial={initial.list}
    variant="plain"
    url={false}
    {picker}
    {onPick}
    {onCancel}
    toggle={multiple ? (id: string) => href({ picked: toggle(id) }) : null}
  />

  {#if multiple}
    <div class="flex flex-wrap items-center justify-between gap-2" data-testid="drive-picker-footer">
      <div class="flex flex-wrap items-center gap-2">
        {#if initial.step === 'chosen'}
          {#if pickedCount > 0}
            {#if canApply && applyTarget}
              <Button href={applyTarget} size="sm" data-testid="drive-picker-apply">Применить</Button>
            {:else}
              <Button type="button" size="sm" disabled aria-disabled="true" data-testid="drive-picker-apply">
                Применить
              </Button>
            {/if}
          {/if}
          {#if pickedCount > 0}
            <Button href={href({ picked: [] })} variant="outline" size="sm" data-testid="drive-picker-clear">
              Сбросить выбор
            </Button>
          {/if}
        {:else}
          {#if pickedCount > 0}
            <Button href={href({ picked: [] })} variant="outline" size="sm" data-testid="drive-picker-clear">
              Сбросить выбор
            </Button>
          {/if}
          {#if pickedCount > 0 && onPicked}
            <Button
              type="button"
              size="sm"
              onclick={() => onPicked?.(initial.picked, [])}
            >Выбранные ({pickedCount})</Button>
          {:else if pickedCount > 0}
            <Button href={href({ step: 'chosen' })} size="sm">Выбранные ({pickedCount})</Button>
          {/if}
        {/if}
      </div>
      {#if onCancel}
        <Button type="button" variant="ghost" size="sm" onclick={() => onCancel?.()}>Отмена</Button>
      {:else}
        <Button href={initial.from} variant="ghost" size="sm">Отмена</Button>
      {/if}
    </div>

    {#if initial.step === 'chosen' && pickedCount === 0}
      <Empty
        size="sm"
        align="start"
        title="Ничего не выбрано"
        description="Отметьте файлы или папки на шаге выбора."
        data-testid="drive-picker-empty-chosen"
      />
    {/if}
  {/if}
</div>
