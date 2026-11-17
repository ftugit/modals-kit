/**
 * Пути «Диска»: байтовый путь в `#core/lib/storage` и путь отображения.
 *
 * Логический путь байтов — `drive/<owner_id>/<node_id>`. Он уникален для узла
 * (копия получает свой id), поэтому дедупликация работает на уровне реестра
 * хранилища, а не имени файла, и переименование не трогает байты.
 */
import { assertDriveName } from './names.js'
import type { DriveBreadcrumb } from './types.js'

/** Префикс всех объектов «Диска» в общем хранилище приложения. */
export const DRIVE_STORAGE_PREFIX = 'drive'

/** Идентификатор — uuid или служебный слаг; слэши и точки пути запрещены. */
const ID_RE = /^[0-9a-z][0-9a-z_-]{0,63}$/i

function assertId(value: string, label: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new RangeError(`[drive] недопустимый ${label}: «${String(value)}»`)
  }
  return value
}

/** Путь байтов узла в общем хранилище приложения. */
export function driveStoragePath(ownerId: string, nodeId: string): string {
  return `${DRIVE_STORAGE_PREFIX}/${assertId(ownerId, 'ownerId')}/${assertId(nodeId, 'nodeId')}`
}

/**
 * Путь отображения: `driveJoin('/Отчёты', '2026.pdf')` → `/Отчёты/2026.pdf`.
 * Имя проверяется тем же правилом, что и в модели, — собрать путь с `/`
 * внутри сегмента нельзя.
 */
export function driveJoin(parent: string | null, name: string): string {
  const leaf = assertDriveName(name)
  if (!parent) return leaf
  return `${parent.replace(/\/+$/, '')}/${leaf}`
}

/**
 * Крошки из цепочки «корень → текущая папка». Дубликаты id отбрасываются:
 * битое дерево не должно рисовать бесконечную ленту.
 */
export function driveBreadcrumbs(chain: readonly DriveBreadcrumb[]): DriveBreadcrumb[] {
  const out: DriveBreadcrumb[] = []
  const seen = new Set<string>()
  for (const crumb of chain) {
    if (seen.has(crumb.id)) continue
    seen.add(crumb.id)
    out.push({ id: crumb.id, name: crumb.name })
  }
  return out
}
