export const DRIVE_PICKER_CHANNEL_PREFIX = 'picker:drive.target:'

/** Канал на параметр (`target_id`), как в контракте плана §2.6. */
export function drivePickerChannel(param: string): string {
  return `${DRIVE_PICKER_CHANNEL_PREFIX}${param}`
}

export type DriveTargetPicked =
  | { readonly seq: number; readonly mode: 'single'; readonly id: string | null; readonly label: string }
  | {
      readonly seq: number
      readonly mode: 'multiple'
      readonly id: null
      readonly label: ''
      readonly ids: readonly string[]
      readonly labels: readonly string[]
    }

let pickSeq = 0

/** Монотонный счётчик канала: `Date.now()` не различает два выбора в одну мс. */
export function nextDrivePickSeq(): number {
  pickSeq += 1
  return pickSeq
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Single-guard move/copy: только явный `mode:'single'` без свойства `ids`
 * и с `id` — UUID или явный `null`. Всё остальное не меняет цель.
 */
export function isSingleDriveTarget(raw: unknown): raw is Extract<DriveTargetPicked, { mode: 'single' }> {
  if (!raw || typeof raw !== 'object') return false
  const payload = raw as Record<string, unknown>
  if (payload.mode !== 'single') return false
  if ('ids' in payload) return false
  if (!('id' in payload)) return false
  return payload.id === null || (typeof payload.id === 'string' && UUID.test(payload.id))
}
