/**
 * Инварианты «Диска» (`plan-drive.md` §4.2) — одна точка правды для модели,
 * сервисов и тестов.
 *
 * Файл чистый: только домен `#core/lib/drive` и словарь сообщений. Проверки
 * формы возвращают список нарушений (их понимает `checks` модели), проверки
 * операции — код отказа или `null`.
 */
import {
  checkDriveName,
  driveNameKey,
  canMove,
  type DriveMoveProblem,
  type DriveNodeKind,
  type DriveShareRole,
  type DriveTreeNode,
} from '#core/lib/drive/index.js'
import { driveIssue, type DriveIssue } from './messages.js'

/** Предел вложенности: глубже — отказ, а не бесконечный обход предков. */
export const DRIVE_MAX_DEPTH = 32

/** Виды узла в порядке объявления для `s.enum`. */
export const DRIVE_KINDS = ['folder', 'file'] as const satisfies readonly DriveNodeKind[]

/** Роли `drive_share` в порядке возрастания прав. */
export const DRIVE_SHARE_ROLES = ['viewer', 'editor'] as const satisfies readonly DriveShareRole[]

/** Значения узла, которые проверяет модель при вставке и правке. */
export interface DriveNodeValues {
  readonly kind?: unknown
  readonly file_id?: unknown
  readonly name?: unknown
  readonly size?: unknown
  readonly hash?: unknown
  readonly content_type?: unknown
}

const isKind = (value: unknown): value is DriveNodeKind =>
  typeof value === 'string' && (DRIVE_KINDS as readonly string[]).includes(value)

const isShareRole = (value: unknown): value is DriveShareRole =>
  typeof value === 'string' && (DRIVE_SHARE_ROLES as readonly string[]).includes(value)

/** Причина отказа имени — готовый код словаря (`drive.name-*`). */
export function checkDriveNameCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'drive.name-empty'
  const problem = checkDriveName(raw)
  return problem ? `drive.name-${problem}` : null
}

/**
 * Проверка значений узла. `operation` важен: при `insert` обязательны вид,
 * размер и согласованность `file_id`, при `update` проверяется только то, что
 * пришло (частичная правка не должна требовать чужого поля).
 */
export function checkNodeValues(
  values: DriveNodeValues,
  operation: 'insert' | 'update' = 'insert',
): DriveIssue[] {
  const issues: DriveIssue[] = []
  const { kind, file_id, name, size } = values

  if (operation === 'insert' || kind !== undefined) {
    if (!isKind(kind)) issues.push(driveIssue('kind', 'drive.kind-invalid'))
    else if (kind === 'folder' && file_id !== undefined && file_id !== null)
      issues.push(driveIssue('file_id', 'drive.file-id-unexpected'))
    else if (kind === 'file' && (file_id === undefined || file_id === null || file_id === ''))
      issues.push(driveIssue('file_id', 'drive.file-id-missing'))
  } else if (operation === 'update' && file_id !== undefined && file_id !== null && file_id !== '') {
    // Вид при частичной правке неизвестен — сверяет сервис, у него есть строка.
  }

  if (operation === 'insert' || name !== undefined) {
    const code = checkDriveNameCode(name)
    if (code) issues.push(driveIssue('name', code))
  }

  if (operation === 'insert' || size !== undefined) {
    const valid =
      (typeof size === 'number' && Number.isInteger(size) && size >= 0) ||
      (typeof size === 'string' && /^\d+$/.test(size))
    if (!valid) issues.push(driveIssue('size', 'drive.size-invalid'))
  }

  if (values.hash !== undefined && values.hash !== null && typeof values.hash !== 'string')
    issues.push(driveIssue('hash', 'drive.size-invalid'))
  if (
    values.content_type !== undefined &&
    values.content_type !== null &&
    typeof values.content_type !== 'string'
  )
    issues.push(driveIssue('content_type', 'drive.size-invalid'))

  return issues
}

/**
 * Занято ли имя в папке. `siblings` — живые соседи, `exceptId` — сам
 * переименовываемый узел. Сравнение по `driveNameKey`, как у `lower(name)`
 * в уникальном индексе.
 */
export function isDriveNameTaken(
  siblings: readonly { readonly id: string; readonly name: string }[],
  name: string,
  exceptId?: string | null,
): boolean {
  const key = driveNameKey(name)
  return siblings.some((item) => item.id !== exceptId && driveNameKey(item.name) === key)
}

/** Код отказа переноса или `null`. Обёртка над `canMove` с текстами словаря. */
export function checkDriveMove(
  node: DriveTreeNode,
  target: DriveTreeNode,
  subtreeIds: readonly string[],
): string | null {
  const problem: DriveMoveProblem | null = canMove(node, target, subtreeIds)
  return problem ? `drive.move-${problem}` : null
}

/** Код отказа роли доступа или `null`. */
export function checkShareRole(role: unknown): string | null {
  return isShareRole(role) ? null : 'drive.share-role-invalid'
}
