// Серверная половина экрана переноса: отчёт → слова для человека, приём решений
// через слои lib/form (метод, origin, лимиты, имена) и `schemaAdmin` (секрет).
import { choices, stepKey } from '#lib/db/sync/index.js'
import type { Choice, SchemaReport } from '#lib/db/sync/index.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler, type Handled } from '#lib/form/server.js'
import { schemaAdmin, schemaStepTask } from '#lib/server/db.js'
import { currentReport } from '#lib/server/task-stream.js'
import { invalidateLiveCache } from '#lib/server/live-cache.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import { schemaForm, type SchemaScreen, type StepView } from './schema'

type Step = SchemaReport['conflicts'][number]

/** `"public"."post"` → `post`; чужая схема остаётся в имени. */
const tableName = (t: string) => t.replace(/^"public"\./, '').replaceAll('"', '')

const DROP = 'Удалить колонку (данные удалятся)'

/** Заголовок, подсказка и подписи решений по виду шага. */
function words(step: Step): {
  title: string
  hint?: string
  labels: Partial<Record<Choice, string>>
} {
  const c = `«${step.column ?? ''}»`
  switch (step.kind) {
    case 'rename_or_replace':
      return {
        title: `Колонка «${step.from}» пропала из модели, ${c} появилась`,
        labels: {
          rename: 'Переименовать (данные сохранятся)',
          replace: `Удалить старую и добавить новую (данные «${step.from}» удалятся)`,
        },
      }
    case 'change_type':
      return {
        title: `Тип колонки ${c} меняется`,
        labels: { apply: 'Привести данные к новому типу' },
      }
    case 'extra_required_column':
      return {
        title: `Колонки ${c} нет в модели, а в базе она обязательная`,
        labels: { apply: DROP },
      }
    case 'extra_column':
      return { title: `Колонки ${c} нет в модели`, labels: { apply: DROP } }
    case 'add_required_column':
      return {
        title: `Новая обязательная колонка ${c} без значения по умолчанию, а в таблице есть строки`,
        hint: 'Задайте db.default или сделайте поле необязательным',
        labels: {},
      }
    case 'nulls_in_required':
      return {
        title: `В колонке ${c} есть пустые значения, а модель требует значение`,
        hint: 'Заполните или сделайте необязательным',
        labels: {},
      }
    case 'unique_duplicates':
      return {
        title: `В ${c} есть повторы, а модель требует уникальности`,
        hint: 'Уберите повторы',
        labels: {},
      }
    case 'sql_changed':
      return {
        title: `Текст ручного SQL ${c} изменился`,
        hint: 'Верните прежний текст или дайте шагу новый id',
        labels: {},
      }
    case 'primary_key':
      return step.sql.length
        ? {
            title: `У таблицы нет первичного ключа ${c}`,
            labels: { apply: 'Добавить первичный ключ' },
          }
        : {
            title: `Первичный ключ таблицы не ${c}`,
            hint: 'Поменяйте ключ в базе вручную или в модели',
            labels: {},
          }
    default:
      return {
        title: `Шаг ${step.kind} для ${c}`,
        labels: { apply: 'Выполнить предложенное' },
      }
  }
}

function view(step: Step, index: number): StepView {
  const { title, hint, labels } = words(step)
  const key = stepKey(step)
  const can = choices(step)
  const where = step.kind === 'sql_changed' ? 'ручной SQL' : `таблица ${tableName(step.table)}`
  const keep = step.level === 'notice' ? 'Оставить колонку' : 'Не трогать сейчас'
  return {
    field: can.length ? `s${index}` : null,
    title,
    where,
    hint,
    options: can.length
      ? [{ value: `keep|${key}`, label: keep }, ...can.map((c) => ({ value: `${c}|${key}`, label: labels[c] ?? c }))]
      : [],
    blocking: step.level === 'conflict',
  }
}

/** Экран переноса или `null`, если схема в порядке (решать нечего). */
export async function schemaScreen(): Promise<SchemaScreen | null> {
  const report = await schemaAdmin.status()
  if (report.status === 'ok') return null
  return {
    enabled: schemaAdmin.enabled,
    steps: [...report.conflicts, ...report.notices].map(view),
  }
}

const error = (code: string, message: string, path?: string): FormError => ({
  id: `${path ?? '*'}:${code}:0`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

/**
 * Приём решений. `null` — решать уже нечего (другой экземпляр успел): маршрут
 * просто ведёт на страницу. Описание строится из СВЕЖЕГО отчёта, поэтому вариант
 * с экрана, которого больше нет, отклоняет проверка вариантов, а не база.
 */
export async function handleSchemaResolve(request: Request, from: 'action' | 'fetch'): Promise<Handled | null> {
  const screen = await schemaScreen()
  if (!screen) return null
  return createFormHandler<{ message: string }>({
    description: schemaForm(screen),
    order: SECURITY_LAYERS,
    async execute({ values, commit, fail }) {
      const decisions: Record<string, Choice> = {}
      for (const step of screen.steps) {
        const raw = step.field ? values[step.field] : undefined
        if (typeof raw !== 'string') continue
        const cut = raw.indexOf('|')
        const choice = raw.slice(0, cut)
        if (choice !== 'keep') decisions[raw.slice(cut + 1)] = choice as Choice
      }
      if (!Object.keys(decisions).length)
        return fail([error('schema.nothing', 'Выберите, что сделать хотя бы с одним шагом')])
      // Ход переноса — строками ответа, если клиент их просил (`taskResponse`).
      const report = currentReport()
      const out = await schemaAdmin.resolve(values.token, decisions, {
        onStep: report && ((step) => report(schemaStepTask('Перенос схемы', step))),
      })
      // «Секрет не подошёл» — под полем: ошибка закреплена за введённым значением
      // (lib/form) и уходит при правке, а не на уходе с поля под нажатой кнопкой.
      if (!out.ok) return fail([error(`schema.${out.reason}`, out.message, out.reason === 'token' ? 'token' : undefined)])
      commit()
      invalidateLiveCache()
      return { data: { message: 'Перенос выполнен' } }
    },
  })(request, from)
}
