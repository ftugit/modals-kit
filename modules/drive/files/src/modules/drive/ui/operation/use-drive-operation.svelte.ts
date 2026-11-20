import { goto } from '$app/navigation'
import type { BoundForm } from '#core/lib/form/svelte/index.js'
import { invalidatePaginator } from '#core/lib/paginate/index.js'
import { tryUseModals } from '#core/lib/modals/svelte/index.js'
import { DRIVE_OPERATIONS, type DriveOperationName } from '../../operations.js'
import { DRIVE_NAME } from '../../source.js'
import { driveSuccess } from './success.js'

const LOADERS = [
  'drive.browse',
  'drive.trash',
  'drive.node',
  'drive.picker',
  'drive.access',
  'drive.filters',
  'drive.starred',
]

export function useDriveOperation(input: {
  op: DriveOperationName
  form: BoundForm
  onDone?: () => void
}): void {
  let handled = ''
  $effect(() => {
    const result = input.form.state.result
    if (!result?.ok || result.submissionId === handled) return
    handled = result.submissionId
    const spec = DRIVE_OPERATIONS[input.op]
    if (spec.inlineSuccess) return

    const m = tryUseModals()
    // Хост модалок смонтирован и на обычной странице: слой — это непустая
    // цепочка, а не наличие контекста. Иначе страница операции считалась бы
    // модалкой и успех не вёл бы на `next`.
    const inModal = Boolean(m && m.view.chain.length > 0)
    const redirect = result.redirect ?? null
    const success = driveSuccess({ success: spec.success, inModal, redirect })

    void invalidatePaginator(DRIVE_NAME)
    if (m && inModal) {
      for (const name of LOADERS) m.modals.invalidateLoader(name)
    }
    input.onDone?.()
    if (success.kind === 'close' && inModal) m?.modals.close()
    if (success.kind === 'goto') {
      // Целевой переход — новая запись истории; закрытие с шагом назад
      // отменило бы его, поэтому слой снимается без `back`.
      if (inModal) m?.modals.close({ replace: true })
      void goto(success.href)
    }
  })
}
