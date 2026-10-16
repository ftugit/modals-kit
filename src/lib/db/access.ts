/**
 * Ключи доступа модели (`access`, docs/design/model-automation.md §14): поле, значение
 * которого в запросе включает проверку прав. Здесь только описания — они попадают в
 * браузер вместе с моделью; проверки строит сервер (`rules.ts`).
 */
import type { AccessKey, AccessOp } from "./types";

const OPS: readonly AccessOp[] = ["select", "insert", "update", "delete"];

/**
 * Ключ «владелец»: значение поля сравнивается с текущим пользователем (`ctx.principal.id`).
 * `ops` — какие операции ключ разрешает (по умолчанию все).
 */
export const owner = (ops: readonly AccessOp[] = OPS): AccessKey => Object.freeze({ kind: "owner", ops: Object.freeze([...ops]) });

/**
 * Ключ «связь»: поле ссылается на другую модель (`db.references`); операция модели
 * проверяется правилом цели — имя правила её `policy` (`select` или именованное). Нет
 * операции в описании — ключ её не разрешает.
 */
export const link = (rules: Partial<Record<AccessOp, string>>): AccessKey =>
  Object.freeze({ kind: "link", rules: Object.freeze({ ...rules }) });
