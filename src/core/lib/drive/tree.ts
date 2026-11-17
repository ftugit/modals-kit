/**
 * Дерево «Диска»: поддерево, скрытые корзиной узлы, проверка переноса и план
 * восстановления (`plan-drive.md` §4.2–4.3).
 *
 * Все функции принимают уже прочитанные узлы и ничего не запрашивают: решение
 * принимает домен, а БД остаётся источником истины. Циклы в данных не
 * предполагаются, но обходы защищены от них — битая строка не должна вешать
 * запрос.
 */
import type { DriveTreeNode } from './types.js'

/** Почему перенос запрещён. Тексты — в `modules/drive/messages.ts`. */
export type DriveMoveProblem =
  | 'self'
  | 'not-folder'
  | 'foreign-owner'
  | 'cycle'
  | 'trashed-target'

/** Дети по родителю; `null` — корень. */
function childrenByParent(
  items: readonly DriveTreeNode[],
): Map<string | null, DriveTreeNode[]> {
  const map = new Map<string | null, DriveTreeNode[]>()
  for (const item of items) {
    const list = map.get(item.parentId)
    if (list) list.push(item)
    else map.set(item.parentId, [item])
  }
  return map
}

/**
 * Идентификаторы поддерева, включая сам `rootId`. Неизвестный корень — пустой
 * массив. Порядок — обход в ширину, чтобы первый элемент всегда был корнем.
 */
export function collectSubtreeIds(
  items: readonly DriveTreeNode[],
  rootId: string,
): string[] {
  const known = new Set(items.map((item) => item.id))
  if (!known.has(rootId)) return []
  const children = childrenByParent(items)
  const out: string[] = []
  const seen = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    for (const child of children.get(id) ?? []) queue.push(child.id)
  }
  return out
}

/**
 * Узлы, скрытые корзиной предка: сам узел жив, но лежит внутри удалённой
 * папки. Мягкое удаление не трогает детей физически, поэтому списки обязаны
 * отсекать их отдельно.
 */
export function collectTrashedIds(items: readonly DriveTreeNode[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const memo = new Map<string, boolean>()
  const trashed = (id: string, trail: Set<string>): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (trail.has(id)) return false
    const node = byId.get(id)
    if (!node) return false
    trail.add(id)
    const parent = node.parentId === null ? null : byId.get(node.parentId)
    const hidden = parent ? parent.trashedAt !== null || trashed(parent.id, trail) : false
    trail.delete(id)
    memo.set(id, hidden)
    return hidden
  }
  const out: string[] = []
  for (const item of items) {
    if (trashed(item.id, new Set())) out.push(item.id)
  }
  return out
}

/**
 * Можно ли перенести `node` в папку `target`. `subtreeIds` — результат
 * `collectSubtreeIds` для переносимого узла (включая его самого).
 */
export function canMove(
  node: DriveTreeNode,
  target: DriveTreeNode,
  subtreeIds: readonly string[],
): DriveMoveProblem | null {
  if (node.id === target.id) return 'self'
  if (target.kind !== 'folder') return 'not-folder'
  if (node.ownerId !== target.ownerId) return 'foreign-owner'
  if (target.trashedAt !== null) return 'trashed-target'
  if (subtreeIds.includes(target.id)) return 'cycle'
  return null
}

/**
 * Куда вернуть узел из корзины. Прежний родитель жив — возвращаем к нему;
 * иначе в корень (правило явное и проверяется тестом, а не «как получится»).
 */
export function restorePlan(
  node: Pick<DriveTreeNode, 'trashedFrom'>,
  parentExists: boolean,
): { readonly parentId: string | null } {
  return { parentId: node.trashedFrom !== null && parentExists ? node.trashedFrom : null }
}
