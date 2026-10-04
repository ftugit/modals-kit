// Источник описания и протокол устаревания.
//
// Набор полей НЕ приходит от клиента: сервер поднимает описание сам по
// идентификатору и версии из конверта. Клиент, назначающий себе поля,
// назначал бы себе проверки.
import { applyOps, editor } from './editor'
import type { FieldDescriptor, FormDescription } from './describe'
import { compileFieldSpecs, type FieldSpec } from './spec'
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

export interface UserFieldStore {
  load(formId: FormId, version?: number): Promise<readonly FieldSpec[]>
  currentVersion(formId: FormId): Promise<number>
}

export class SpecSourceError extends Error {
  constructor(public readonly defects: readonly unknown[]) {
    super('[form] спецификация пользовательских полей отклонена')
    this.name = 'SpecSourceError'
  }
}

export function appendFields(d: FormDescription, fields: readonly FieldDescriptor[]) {
  return fields.length ? applyOps(d, fields.map((f) => editor.add(f))) : d
}

/** Базовое описание из кода плюс поля из хранилища приложения. */
export function createAppSource(
  base: Readonly<Record<FormId, FormDescription>>,
  store: UserFieldStore,
  o: { allowCustomPattern?: boolean } = {},
): DescriptionSource {
  const need = (formId: FormId) => {
    const d = base[formId]
    if (!d) throw new Error(`[form] форма не объявлена: ${formId}`)
    return d
  }
  return {
    async resolve(ctx) {
      const d = need(ctx.formId)
      const specs = await store.load(ctx.formId, ctx.specVersion)
      if (!specs.length) return d
      const compiled = compileFieldSpecs(specs, {
        registry: d.registry, policy: d.policy, allowCustomPattern: o.allowCustomPattern,
      })
      if (!compiled.ok) throw new SpecSourceError(compiled.defects)
      return appendFields(d, compiled.fields)
    },
    async revision(ctx) {
      return need(ctx.formId).revision + (await store.currentVersion(ctx.formId))
    },
  }
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
 * Страница открыта, набор полей сменился, форма отправлена.
 * Ошибки сбрасываются, значения переносятся по именам, новые поля помечены
 * свежими — обязательность им в этом круге не навязывается.
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
