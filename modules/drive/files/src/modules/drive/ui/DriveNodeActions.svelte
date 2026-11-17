<script lang="ts">
  /**
   * Действия строки «Диска» (4d–4f): звёздочка, переименование, перенос,
   * копия, корзина; в корзине — восстановление и окончательное удаление.
   *
   * Формы нативные (`intercept: false`): без JS это обычный POST на
   * `<страница>?/<action>`, с JS — та же отправка. Вложенного интерактива нет:
   * карточка рисует действия рядом со ссылкой, а не внутри неё.
   */
  import { untrack } from 'svelte'
  import Field from '#core/ui/form/Field.svelte'
  import { Button } from '#core/ui/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import { bind, Form } from '#core/lib/form/svelte/index.js'
  import {
    driveCopyForm,
    driveMoveForm,
    driveRenameForm,
    driveShareForm,
    driveStarForm,
    driveTrashForm,
  } from '../form.js'
  import type { DriveFolderOption } from '../form.js'
  import type { DrivePick } from '../types.js'
  import { drivePickerRoute } from '../routes.js'

  interface Props {
    nodeId: string
    name: string
    starred: boolean
    canWrite: boolean
    trashed: boolean
    folders: readonly DriveFolderOption[]
    /** Адрес страницы, на которую вернётся POST (без `?/action`). */
    returnTo: string
    canShare?: boolean
    /** Выбор папки из пикера, вернувшийся в адресе страницы. */
    pick?: DrivePick | null
    /** Текущая папка страницы: с неё начинается пикер. */
    folderId?: string | null
  }

  let {
    nodeId,
    name,
    starred,
    canWrite,
    trashed,
    folders,
    returnTo,
    canShare = false,
    pick = null,
    folderId = null,
  }: Props = $props()

  // Привязка — один раз на строку: узел и адрес возврата не меняются без перезагрузки.
  const init = untrack(() => ({ nodeId, name, starred, folders, returnTo, canShare, pick, folderId }))
  const actionBase = init.returnTo.split('?')[0]
  const shortId = init.nodeId.replace(/-/g, '').slice(0, 8)
  /** Одна привязка на действие: нативный POST + уникальный instance строки. */
  const bindAt = (description: ReturnType<typeof driveRenameForm>, action: string) =>
    bind(forms, description, {
      action: `${actionBase}?/${action}`,
      instance: `drive:${action}-${shortId}`,
      intercept: false,
    })
  const pickedFor = (op: 'move' | 'copy'): string | null =>
    init.pick?.nodeId === init.nodeId && init.pick.op === op ? init.pick.targetId : null
  const pickerHref = (op: 'move' | 'copy'): string => {
    const from = new URL(init.returnTo, 'http://local')
    from.searchParams.set('pick', op)
    from.searchParams.set('node', init.nodeId)
    const query = new URLSearchParams({
      from: `${from.pathname}?${from.searchParams.toString()}`,
      param: 'target_id',
      kind: 'folder',
    })
    if (init.folderId) query.set('folder', init.folderId)
    return `${drivePickerRoute.href()}?${query.toString()}`
  }
  const movePicker = pickerHref('move')
  const copyPicker = pickerHref('copy')
  const moveOpen = init.pick?.nodeId === init.nodeId && init.pick.op === 'move'
  const copyOpen = init.pick?.nodeId === init.nodeId && init.pick.op === 'copy'

  const rename = bindAt(driveRenameForm(init.nodeId, init.name, init.returnTo), 'rename')
  const move = bindAt(
    driveMoveForm(init.nodeId, init.folders, init.returnTo, pickedFor('move')),
    'move',
  )
  const copy = bindAt(
    driveCopyForm(init.nodeId, init.folders, init.returnTo, pickedFor('copy')),
    'copy',
  )
  const star = bindAt(driveStarForm(init.nodeId, init.starred, init.returnTo), 'star')
  const trash = bindAt(driveTrashForm(init.nodeId, init.returnTo), 'trash')
  const restore = bindAt(driveTrashForm(init.nodeId, init.returnTo), 'restore')
  const purge = bindAt(driveTrashForm(init.nodeId, init.returnTo), 'purge')
  const share = init.canShare
    ? bindAt(driveShareForm(init.nodeId, init.returnTo), 'share')
    : null
</script>

<div class="flex flex-wrap items-center gap-1" data-testid="drive-node-actions">
  {#if trashed}
    <Form form={restore} hiddenFields={restore.hidden()} class="inline">
      <Button type="submit" variant="outline" size="sm">Восстановить</Button>
    </Form>
    <Form form={purge} hiddenFields={purge.hidden()} class="inline">
      <Button type="submit" variant="ghost" size="sm" data-testid="drive-purge">Удалить навсегда</Button>
    </Form>
  {:else if canWrite}
    <Form form={star} hiddenFields={star.hidden()} class="inline">
      <Button type="submit" variant="ghost" size="sm">
        {starred ? 'Снять важное' : 'Важное'}
      </Button>
    </Form>
    <Form form={trash} hiddenFields={trash.hidden()} class="inline">
      <Button type="submit" variant="ghost" size="sm">В корзину</Button>
    </Form>

    <details class="relative">
      <summary class="cursor-pointer rounded-md px-2 py-1 text-sm hover:bg-muted">Изменить</summary>
      <div class="mt-2 flex flex-col gap-3 rounded-lg border border-border p-3">
        <Form form={rename} hiddenFields={rename.hidden()} class="flex flex-col gap-2">
          <Field of={rename.f.name} />
          <Button type="submit" size="sm">Переименовать</Button>
        </Form>
        <details open={moveOpen}>
          <summary class="cursor-pointer text-sm text-muted-foreground">Перенос</summary>
          <Form form={move} hiddenFields={move.hidden()} class="flex flex-col gap-2 pt-2">
            <Field of={move.f.target_id} />
            <div class="flex items-center justify-between gap-2">
              <a class="text-xs underline" href={movePicker}>Выбрать папку…</a>
              <Button type="submit" variant="outline" size="sm">Перенести</Button>
            </div>
          </Form>
        </details>
        <details open={copyOpen}>
          <summary class="cursor-pointer text-sm text-muted-foreground">Копия</summary>
          <Form form={copy} hiddenFields={copy.hidden()} class="flex flex-col gap-2 pt-2">
            <Field of={copy.f.target_id} />
            <Field of={copy.f.name} />
            <div class="flex items-center justify-between gap-2">
              <a class="text-xs underline" href={copyPicker}>Выбрать папку…</a>
              <Button type="submit" variant="outline" size="sm">Скопировать</Button>
            </div>
          </Form>
        </details>
        {#if share}
          <Form form={share} hiddenFields={share.hidden()} class="flex flex-col gap-2">
            <Field of={share.f.uid} />
            <Field of={share.f.role} />
            <Button type="submit" variant="outline" size="sm">Выдать доступ</Button>
          </Form>
        {/if}
      </div>
    </details>
  {:else if canShare && share}
    <details class="relative">
      <summary class="cursor-pointer rounded-md px-2 py-1 text-sm hover:bg-muted">Доступ</summary>
      <div class="mt-2 rounded-lg border border-border p-3">
        <Form form={share} hiddenFields={share.hidden()} class="flex flex-col gap-2">
          <Field of={share.f.uid} />
          <Field of={share.f.role} />
          <Button type="submit" variant="outline" size="sm">Выдать доступ</Button>
        </Form>
      </div>
    </details>
  {/if}
</div>
