/**
 * Серверная половина экрана переноса схемы: отчёт → экран, приём решений.
 *
 * Экран живёт ВНЕ демо-маршрута (`/schema`), потому что `schema_pending` ловят
 * все страницы с БД, а не только `/db-demo`: пока расхождение не снято, любой их
 * запрос отвечает 503. Раньше единственная кнопка «Выполнить» была внутри демо —
 * для остальных страниц это был тупик.
 *
 * Ничего прикладного, кроме дома в приложении: отчёт и перенос — `#lib/db/sync`
 * (`createSchemaAdmin`), секрет и ленивый драйвер — `#server/db.server.js`,
 * решения — кодек `#lib/db/sync` (`decisionsFrom`), приём — `#lib/form/server`.
 */
import { decisionsFrom, type Choice } from '#lib/db/sync/index.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler, type Handled } from '#lib/form/server.js'
import { schemaAdmin, schemaStepTask } from '#server/db.server.js'
import { currentReport } from '#hooks/task-stream.server.js'
import { createIpThrottle, type ClientAddressSource } from '#server/client-ip.server.js'
import { invalidateLiveCache } from '#server/live-cache.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import {
  decisionFields,
  schemaForm,
  screenFrom,
  type SchemaScreen,
} from './db-schema.js'

/**
 * Текущий экран переноса или `null`, если решать нечего.
 *
 * `status()` открывает ленивый драйвер мимо `gate` (`#server/db.server.js`):
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
const schemaResolveThrottle = createIpThrottle('db-schema', 10, 60_000)

export async function handleSchemaResolve(
  request: Request,
  from: 'action' | 'fetch',
  event?: ClientAddressSource,
): Promise<Handled | null> {
  const screen = await schemaScreen()
  if (!screen) return null
  return createFormHandler<{ message: string }, ClientAddressSource>({
    description: schemaForm(screen),
    order: SECURITY_LAYERS,
    throttle: schemaResolveThrottle,
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
        return fail([error('schema.nothing', 'Выберите, что сделать хотя бы с одним шагом')])
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
  })(request, from, event)
}
