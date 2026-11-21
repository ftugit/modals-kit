/**
 * Серверная половина экрана переноса схемы: отчёт → экран, приём решений.
 *
 * Экран живёт ВНЕ демо-маршрута (`/schema`), потому что `schema_pending` ловят
 * все страницы с БД, а не только `/db-demo`: пока расхождение не снято, любой их
 * запрос отвечает 503. Раньше единственная кнопка «Выполнить» была внутри демо —
 * для остальных страниц это был тупик.
 *
 * Ничего прикладного, кроме дома в приложении: отчёт и перенос — `#core/lib/db/sync`
 * (`createSchemaAdmin`), секрет и ленивый драйвер — `#core/server/db.server.js`,
 * решения — кодек `#core/lib/db/sync` (`decisionsFrom`), приём — `#core/lib/form/server`.
 */
import { decisionsFrom, type Choice } from '#core/lib/db/sync/index.js'
import type { FormError } from '#core/lib/form/index.js'
import { createFormHandler, type Handled } from '#core/lib/form/server.js'
import { error as httpError, type RequestEvent } from '@sveltejs/kit'
import { schemaAdmin, schemaStepTask } from '#core/server/db.server.js'
import { currentReport } from '#core/hooks/task-stream.server.js'
import type { ClientAddressSource } from '#core/server/client-ip.server.js'
import { invalidateLiveCache } from '#core/server/live-cache.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'
import {
  decisionFields,
  schemaForm,
  schemaUnlockForm,
  screenFrom,
  SCHEMA_UNLOCK_COOKIE,
  SCHEMA_UNLOCK_TTL_SECONDS,
  type SchemaScreen,
} from './db-schema.js'

/**
 * Текущий экран переноса или `null`, если решать нечего.
 *
 * `status()` открывает ленивый драйвер мимо `gate` (`#core/server/db.server.js`):
 * через `gate` при конфликте не проходит ни один запрос, а показать отчёт нужно
 * именно в этот момент.
 *
 * @returns экран с шагами или `null`.
 */
export async function schemaScreen(): Promise<SchemaScreen | null> {
  return screenFrom(await schemaAdmin.status(), schemaAdmin.enabled)
}

const error = (code: string, message: string, path?: string, at = 0): FormError => ({
  id: `${path ?? '*'}:${code}:${at}`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

/**
 * Приём решений.
 *
 * Описание строится из СВЕЖЕГО отчёта, поэтому вариант с экрана, которого
 * больше нет, отклоняет сверка ключа (`decisionsFrom`), а не база. Ключ шага
 * берётся из карты полей, а не из значения: экран не может подсунуть решению
 * чужой шаг.
 *
 * @param request входящий запрос (нативный POST `?/schema` либо fetch).
 * @param from кодировка ответа: `action` — Kit-экшен, `fetch` — JSON.
 * @returns `Handled` либо `null`, если решать уже нечего (другой экземпляр успел).
 */
// Никакого БД-кэша в этих экшенах: при `schema_pending` он отвечает 503, и
// экран нельзя было бы ни открыть, ни разрешить. Защита — секрет в форме.

/**
 * Доступ к отчёту: секрет спрашивается ДО показа схемы. Успех кладёт короткую
 * httpOnly-куку (30 минут) и уводит на тот же `/schema`; кука живёт только на
 * сервере и в форму решений не попадает.
 */
export async function handleSchemaUnlock(event: RequestEvent) {
  return createFormHandler<{ message: string }, ClientAddressSource>({
    description: schemaUnlockForm(),
    order: SECURITY_LAYERS,
    async execute({ values, commit, fail }) {
      const token = String(values.token ?? '')
      if (!(await schemaAdmin.verify(token))) {
        return fail([error('schema.token', 'Секрет не подошёл.')])
      }
      commit()
      event.cookies.set(SCHEMA_UNLOCK_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: event.url.protocol === 'https:',
        maxAge: SCHEMA_UNLOCK_TTL_SECONDS,
      })
      return { redirect: '/schema' }
    },
  })(event.request, 'action', event)
}

export async function handleSchemaResolve(
  event: RequestEvent,
  from: 'action' | 'fetch',
): Promise<Handled | null> {
  // Секрет проверяется ДО чтения схемы: прямой POST на ?/schema не должен
  // применять авто-шаги в обход экрана доступа.
  const unlocked = event.cookies.get(SCHEMA_UNLOCK_COOKIE) ?? ''
  if (!(await schemaAdmin.verify(unlocked))) throw httpError(403, 'schema.locked')
  const screen = await schemaScreen()
  if (!screen) return null
  return createFormHandler<{ message: string }, ClientAddressSource>({
    description: schemaForm(screen),
    order: SECURITY_LAYERS,
    async execute({ values, commit, fail }) {
      const { decisions, problems } = decisionsFrom(
        values as Record<string, unknown>,
        decisionFields(screen),
      )
      // Экран устарел (шаг снят другим экземпляром) или пришло не решение —
      // это не ошибка человека: перезагрузка покажет новый отчёт.
      if (problems.length)
        return fail([
          error('schema.stale', 'Схема изменилась, пока экран был открыт — обновите страницу'),
          ...problems.map((message, i) => error('schema.stale', message, undefined, i + 1)),
        ])
      if (!Object.keys(decisions).length)
        return fail([
        error(
          'schema.nothing',
          'Выберите хотя бы одно действие, отличное от «Не трогать сейчас»',
        ),
      ])
      // Ход переноса — строками ответа, если клиент их просил (`taskResponse`).
      const report = currentReport()
      const out = await schemaAdmin.resolve(values.token, decisions as Record<string, Choice>, {
        onStep: report && ((step) => report(schemaStepTask('Перенос схемы', step))),
      })
      // «Секрет не подошёл» — под полем: ошибка закреплена за введённым значением
      // (lib/form) и уходит при правке, а не на уходе с поля под нажатой кнопкой.
      if (!out.ok)
        return fail([
          error(`schema.${out.reason}`, out.message, out.reason === 'token' ? 'token' : undefined),
        ])
      commit()
      invalidateLiveCache()
      return { data: { message: 'Перенос выполнен' } }
    },
  })(event.request, from, event)
}
