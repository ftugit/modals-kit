/**
 * Полное чтение строк «Диска» (`plan-drive-repair.md` §3.2).
 *
 * Раньше обход останавливался после сотой страницы молча: на большом диске это
 * давало неполный срез и неверные итоги без единого сигнала. Здесь обход идёт
 * до короткой страницы, а превышение явного потолка — ошибка домена
 * (`drive.traversal-limit`), а не тихое усечение.
 */
import type { DriveNodeView } from '#core/lib/drive/index.js'
import type { Database, Filter } from '#core/lib/db/index.js'
import { driveNode } from '../schema.js'
import { DRIVE_SERVER, toDriveNodeView } from './access.js'

/** Потолок строк одного обхода: больше — уже не личный диск, а авария данных. */
export const DRIVE_SCAN_LIMIT = 20_000

/** Явный отказ обхода: наружу уходит кодом `drive.traversal-limit`. */
export class DriveScanLimitError extends Error {
  readonly code = 'drive.traversal-limit'

  constructor() {
    super('drive.traversal-limit')
    this.name = 'DriveScanLimitError'
  }
}

/** Все строки по фильтру: страницы до короткой, потолок — `DRIVE_SCAN_LIMIT`. */
export async function readDriveRows(
  db: Database,
  filter: Filter,
  limit: number = DRIVE_SCAN_LIMIT,
): Promise<DriveNodeView[]> {
  const api = db.resource(driveNode)
  const pageSize = db.limits.maxPageSize
  const out: DriveNodeView[] = []
  for (let page = 1; ; page++) {
    const rows = await api.select(DRIVE_SERVER, {
      filter,
      page,
      limit: pageSize,
      // Стабильный порядок: без него страницы могут пересекаться на живых данных.
      order: [['id', 'asc']],
    })
    const list = rows as unknown as Record<string, unknown>[]
    for (const row of list) out.push(toDriveNodeView(row))
    if (out.length > limit) throw new DriveScanLimitError()
    if (list.length < pageSize) return out
  }
}
