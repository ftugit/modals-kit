/**
 * Перенос схемы по кнопке (шаг 4 `docs/design/db-schema-sync.md`): отчёт «что ждёт
 * решения» и выполнение решений человека под секретом `DB_ADMIN_TOKEN`.
 *
 * Без `$app/*`: драйвер и секрет подставляет `db.ts`, поэтому модуль проверяется на
 * PGlite в тестах. Драйвер — сырой, мимо `gate`: через `gate` любой запрос при
 * конфликте отвечает `schema_pending`, а решать конфликт нужно именно в этот момент.
 */
import { DbFailure, normalizeFailure } from '#lib/db/index.js'
import type { Driver } from '#lib/db/index.js'
import type { Choice, DbSchema, Resolution, SchemaReport } from '#lib/db/sync/index.js'

export type ResolveOutcome =
  | { ok: true; report: SchemaReport }
  | {
      ok: false
      reason: 'disabled' | 'token' | 'stale' | 'invalid' | 'failed'
      message: string
    }

export interface SchemaAdmin {
  /** Секрет задан: без него кнопка выключена. */
  readonly enabled: boolean
  /** Что ждёт решения сейчас (автоматические шаги при этом применяются — они безопасны). */
  status(): Promise<SchemaReport>
  /** Выполнить решения. Секрет сверяется до любого обращения к БД. */
  resolve(token: unknown, decisions: Resolution): Promise<ResolveOutcome>
}

const CHOICES: ReadonlySet<string> = new Set<Choice>(['apply', 'rename', 'replace'])

/**
 * Решения из формы: поля `step:<ключ шага>` со значением `apply` | `rename` | `replace`;
 * пустое значение — «не трогать» (у ожидающих шагов это и есть выбор по умолчанию).
 */
export function decisionsFromForm(data: FormData): Resolution {
  const out: Record<string, Choice> = {}
  for (const [name, value] of data) {
    if (!name.startsWith('step:') || typeof value !== 'string' || !CHOICES.has(value)) continue
    out[name.slice(5)] = value as Choice
  }
  return out
}

/** Сравнение секретов за постоянное время: сравниваются дайджесты одинаковой длины. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export function createSchemaAdmin(options: {
  schema: DbSchema
  driver: () => Promise<Driver>
  token: string | undefined
}): SchemaAdmin {
  const { schema, driver, token } = options
  return {
    enabled: !!token,
    async status() {
      return schema.sync(await driver())
    },
    async resolve(given, decisions) {
      if (!token)
        return {
          ok: false,
          reason: 'disabled',
          message: 'Перенос по кнопке выключен: на сервере не задан DB_ADMIN_TOKEN.',
        }
      if (typeof given !== 'string' || !given || !(await sameSecret(given, token)))
        return { ok: false, reason: 'token', message: 'Секрет не подошёл.' }
      if (!Object.keys(decisions).length)
        return {
          ok: false,
          reason: 'invalid',
          message: 'Не выбрано ни одного решения.',
        }
      try {
        return {
          ok: true,
          report: await schema.sync(await driver(), { resolve: decisions }),
        }
      } catch (e) {
        // Секрет подтверждён — причина видна тому, кто переносит (текст БД нужен ему,
        // чтобы поправить данные), но не посетителям: экран решений только за секретом.
        const failure = e instanceof DbFailure ? e : normalizeFailure(e)
        const detail = failure.details.issues?.join('; ') || String((failure.cause as Error | undefined)?.message ?? '')
        const reason =
          failure.kind === 'conflict' && !failure.details.sqlstate
            ? 'stale'
            : failure.kind === 'validation' && !failure.details.sqlstate
              ? 'invalid'
              : 'failed'
        const head = {
          stale: 'Схема уже изменилась (другой экземпляр или новая версия модели) — обновите страницу.',
          invalid: 'Решение не подходит шагу.',
          failed: 'База отклонила перенос, ничего не изменено.',
        }[reason]
        return {
          ok: false,
          reason,
          message: detail ? `${head} ${detail}` : head,
        }
      }
    },
  }
}
