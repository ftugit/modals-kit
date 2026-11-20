import type { Result } from '#core/lib/form/index.js'
import type { UserConfigRouteData, UserConfigSlice } from '../../model/types.js'
import type { UserSurfaceVariant } from '../Acl.svelte'
import type { AuthErrorCode } from '../../model/error.js'

/** Экранные пропсы носителя настроек: хост передаёт их активной секции. */
export interface UserSettingsScreen {
  readonly initial: UserConfigRouteData | null
  readonly action?: string
  readonly form?: { result?: Result } | null
  readonly doneHref: string
  readonly onAcl?: (fact: AuthErrorCode) => void
  readonly onChange?: (next: UserConfigSlice) => void
  readonly onDone?: () => void
  readonly variant: UserSurfaceVariant
  readonly sessionsContext: 'page' | 'modal'
}
