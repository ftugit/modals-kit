import type { DriveOperationSuccess } from '../../operations.js'

export type DriveSuccess =
  | { readonly kind: 'close' }
  | { readonly kind: 'goto'; readonly href: string }

/** Один выбор успеха: закрытие модалки или переход на цель/возврат. */
export function driveSuccess(input: {
  success: DriveOperationSuccess
  inModal: boolean
  redirect: string | null
}): DriveSuccess {
  if (input.success === 'target' && input.redirect) {
    return { kind: 'goto', href: input.redirect }
  }
  if (input.inModal) return { kind: 'close' }
  // Страница операции — тот же результат, что `303` без JS: возврат на `next`.
  if (input.redirect) return { kind: 'goto', href: input.redirect }
  return { kind: 'close' }
}
