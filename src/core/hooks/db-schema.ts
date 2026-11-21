/**
 * Экран переноса схемы: отчёт `#core/lib/db/sync` → слова для человека → форма решений.
 *
 * Место выбрано по правилу проекта: `#core/hooks/*` — там, где библиотеки соединяются.
 * `lib/db` форму не импортирует, `lib/form` базу не импортирует; описание формы
 * решений собирает приложение (как `#core/hooks/db-form.ts` собирает поля из модели).
 *
 * Модуль изоморфный: ни `$app/*`, ни серверных синглтонов. Его читают
 * `#core/hooks/db-schema.server.ts` (отчёт + приём решений), компонент
 * `#core/ui/db-schema/SchemaPending.svelte` (описание формы) и страница
 * `/schema` (типы).
 */
import { choices, decisionValue, KEEP, stepKey } from '#core/lib/db/sync/index.js'
import type { SchemaReport } from '#core/lib/db/sync/index.js'
import type { Step } from '#core/lib/db/sync/index.js'
import { defineForm, field, v } from '#core/lib/form/index.js'

/** Один шаг, ждущий решения, — уже в словах для человека. */
export interface StepView {
  /** Устойчивый ключ шага (`stepKey`): по нему сервер сверяет решение с отчётом. */
  key: string
  /** Имя поля формы (`s0`, `s1`, …); у шага без вариантов поля нет. */
  field: string | null
  title: string
  /** Где: таблица (и колонка). */
  where: string
  /** Что сделать самому, когда кнопкой это не решить. */
  hint?: string
  /** Варианты: `value` — формат решений `#core/lib/db/sync` (`<решение>|<ключ>`). */
  options: readonly { value: string; label: string }[]
  /** `false` — шаг не блокирует запросы (лишняя необязательная колонка). */
  blocking: boolean
}

/** Форма доступа: секрет спрашивается до отчёта, а не после решений. */
export function schemaUnlockForm() {
  return defineForm({
    id: SCHEMA_UNLOCK_FORM_ID,
    revision: 1,
    actions: [{ id: 'submit', label: 'Открыть отчёт', validate: 'full' }],
    fields: {
      token: field.password({
        label: 'Секрет DB_ADMIN_TOKEN',
        help: 'Отчёт и решения доступны только с этим секретом.',
        validate: [v.required()],
      }),
    },
  })
}

/** Экран переноса: включена ли кнопка и что именно ждёт решения. */
export interface SchemaScreen {
  /** На сервере задан `DB_ADMIN_TOKEN`: кнопка «Выполнить» включена. */
  enabled: boolean
  steps: readonly StepView[]
}

export const SCHEMA_FORM_ID = 'db_schema_resolve'
export const SCHEMA_UNLOCK_FORM_ID = 'db_schema_unlock'
/** Короткая сессия доступа к отчёту: токен спрашивается до показа схемы. */
export const SCHEMA_UNLOCK_COOKIE = 'schema_unlock'
export const SCHEMA_UNLOCK_TTL_SECONDS = 1800

/** `"public"."post"` → `post`; чужая схема остаётся в имени. */
const tableName = (t: string) => t.replace(/^"public"\./, '').replaceAll('"', '')

const DROP = 'Удалить колонку (данные удалятся)'

/**
 * Заголовок, подсказка и подписи решений по виду шага.
 * @param step шаг плана `#core/lib/db/sync`.
 * @returns слова для экрана.
 */
function words(step: Step): {
  title: string
  hint?: string
  labels: Partial<Record<'apply' | 'rename' | 'replace', string>>
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

/**
 * Строка экрана из шага плана.
 * @param step шаг плана.
 * @param index порядковый номер (даёт имя поля `s<index>`).
 * @returns описание шага словами и вариантами.
 */
function view(step: Step, index: number): StepView {
  const { title, hint, labels } = words(step)
  const key = stepKey(step)
  const can = choices(step)
  const where = step.kind === 'sql_changed' ? 'ручной SQL' : `таблица ${tableName(step.table)}`
  const keep = step.level === 'notice' ? 'Оставить колонку' : 'Не трогать сейчас'
  const options = can.length
    ? [
        { value: decisionValue(KEEP, key), label: keep },
        ...can.map((c) => ({ value: decisionValue(c, key), label: labels[c] ?? c })),
      ]
    : []
  return {
    key,
    field: can.length ? `s${index}` : null,
    title,
    where,
    hint,
    options,
    blocking: step.level === 'conflict',
  }
}

/**
 * Экран из отчёта: `null`, когда решать нечего.
 * @param report отчёт `schemaAdmin.status()`.
 * @param enabled задан ли `DB_ADMIN_TOKEN`.
 * @returns экран либо `null` (схема в порядке).
 */
export function screenFrom(report: SchemaReport, enabled: boolean): SchemaScreen | null {
  if (report.status === 'ok') return null
  return {
    enabled,
    steps: [...report.conflicts, ...report.notices].map(view),
  }
}

/**
 * Карта «поле формы → ключ шага» из свежего экрана.
 * @param screen экран, по которому нарисована форма.
 * @returns карта для `decisionsFrom` (`#core/lib/db/sync`).
 */
export function decisionFields(screen: SchemaScreen): Record<string, string> {
  const map: Record<string, string> = {}
  for (const step of screen.steps) if (step.field) map[step.field] = step.key
  return map
}

/**
 * Описание формы решений: секрет + по радиогруппе на каждый шаг с вариантами.
 * @param screen экран из `screenFrom`.
 * @returns описание `#core/lib/form`.
 */
export function schemaForm(screen: SchemaScreen, token = '') {
  const fields: Record<string, ReturnType<typeof field.radio>> = {}
  for (const step of screen.steps)
    if (step.field)
      fields[step.field] = field.radio({
        label: step.title,
        help: step.where,
        options: step.options,
        defaultValue: step.options[0]?.value,
        validate: [v.required()],
      })
  return defineForm({
    id: SCHEMA_FORM_ID,
    revision: 1,
    actions: [{ id: 'submit', label: 'Выполнить', validate: 'full' }],
    fields: {
      ...fields,
      token: field.password({
        label: 'Секрет DB_ADMIN_TOKEN',
        defaultValue: token,
        validate: [v.required()],
      }),
    },
  })
}
