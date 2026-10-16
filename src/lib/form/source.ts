// Источник описания и протокол устаревания.
//
// Набор полей НЕ приходит от клиента: сервер поднимает описание сам по
// идентификатору и версии из конверта. Клиент, назначающий себе поля,
// назначал бы себе проверки.
import type { FormDescription } from './describe'
import type { FormId, InstanceId, Revision } from './types'

export interface DescriptionContext {
  readonly formId: FormId
  readonly instance: InstanceId
  /** Версия спецификации ИЗ КОНВЕРТА, а не «самая свежая» — отсюда детерминизм. */
  readonly specVersion?: number
  readonly locale?: string
  readonly signal?: AbortSignal
}

export interface DescriptionSource {
  resolve(ctx: DescriptionContext): Promise<FormDescription>
  revision(ctx: DescriptionContext): Promise<Revision>
}

/** Хэш состава полей: заметить расхождение, не сравнивая описания целиком. */
export function fieldSetHash(d: FormDescription): string {
  const s = d.fields.map((f) => `${f.name}:${f.kind}:${f.input}`).sort().join('|')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}

export type StaleVerdict =
  | { stale: false }
  | {
      stale: true
      reason: 'revision' | 'field-set'
      fresh: FormDescription
      /** Значения, перенесённые по именам. */
      carried: Record<string, unknown>
      /** Имена, которых в новом наборе нет. */
      dropped: readonly string[]
    }

/**
 * Сверить набор полей страницы с серверным: страница открыта, набор сменился.
 * @param server Свежее описание сервера.
 * @param claimed Ревизия и хэш состава из конверта.
 * @param values Значения формы на странице.
 */
export function checkStale(
  server: FormDescription,
  claimed: { revision: Revision; fieldSetHash?: string },
  values: Record<string, unknown>,
): StaleVerdict {
  const sameRevision = claimed.revision === server.revision
  const sameSet = claimed.fieldSetHash === undefined || claimed.fieldSetHash === fieldSetHash(server)
  if (sameRevision && sameSet) return { stale: false }

  const carried: Record<string, unknown> = Object.create(null)
  const dropped: string[] = []
  for (const [k, v] of Object.entries(values)) {
    if (server.byName[k]) carried[k] = v
    else dropped.push(k)
  }
  return { stale: true, reason: sameRevision ? 'field-set' : 'revision', fresh: server, carried, dropped }
}
