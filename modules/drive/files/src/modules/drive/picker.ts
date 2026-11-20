/**
 * Пикер: чистая логика применения выбора и `chosen`-среза.
 *
 * UI и URL-состояние живут в `DrivePicker`/`DriveBrowse`; здесь только
 * предикаты и построение адреса, чтобы их можно было проверить без DOM.
 */
import { DRIVE_IDS_NONE, DRIVE_KEYS } from './source.js'

export interface ChosenAvailability {
  readonly pickedCount: number
  readonly totalItems: number | null | undefined
  /** `pickedCount - visiblePicked`; `null` — visiblePicked неизвестен. */
  readonly hiddenCount: number | null
}

/**
 * Единственный источник истины для доступности Apply:
 * непустой набор, известный totalItems, целый hiddenCount в диапазоне и 0.
 */
export function canApplyChosen(input: ChosenAvailability): boolean {
  const known =
    typeof input.totalItems === 'number' &&
    Number.isFinite(input.totalItems) &&
    input.totalItems >= 0
  if (input.pickedCount === 0) return false
  if (!known || input.hiddenCount === null) return false
  if (!Number.isInteger(input.hiddenCount)) return false
  if (input.hiddenCount < 0 || input.hiddenCount > input.pickedCount) return false
  return input.hiddenCount === 0
}

/** Срез списка для шага `chosen`: пустой набор — явный `none`, а не «нет среза». */
export function chosenSlice(picked: readonly string[]): Record<string, string> {
  return { [DRIVE_KEYS.ids]: picked.length > 0 ? picked.join(',') : DRIVE_IDS_NONE }
}

export type DriveSelection =
  | { readonly mode: 'single'; readonly id: string | null }
  | { readonly mode: 'multiple'; readonly ids: readonly string[] }

/**
 * Адрес вызывающей страницы после выбора. `null` — применять нечего.
 * `param` — имя поля, а не значение; корень `single` удаляет ключ.
 */
export function applyHref(
  from: string,
  param: string,
  selection: DriveSelection,
): string | null {
  if (selection.mode === 'multiple' && selection.ids.length === 0) return null
  const dest = new URL(from, 'http://local.invalid')
  if (selection.mode === 'single') {
    if (selection.id === null) dest.searchParams.delete(param)
    else dest.searchParams.set(param, selection.id)
  } else {
    dest.searchParams.set(param, selection.ids.join(','))
  }
  return `${dest.pathname}${dest.search}${dest.hash}`
}
