// Экран переноса схемы: изоморфное описание формы. Описание строится из отчёта
// (шаги у каждого расхождения свои), но одинаково на сервере и в странице — оба
// строят его из одного и того же `SchemaScreen`.
import { defineForm, field, v } from '#lib/form/index.js'

/** Один шаг, ждущий решения, — уже в словах для человека. */
export interface StepView {
  /** Имя поля формы (`s0`, `s1`, …); у шага без вариантов поля нет. */
  field: string | null
  title: string
  /** Где: таблица (и колонка). */
  where: string
  /** Что сделать самому, когда кнопкой это не решить. */
  hint?: string
  /** Варианты: `value` = `<решение>|<ключ шага>`, `keep|…` — не трогать. */
  options: readonly { value: string; label: string }[]
  /** `false` — шаг не блокирует запросы (лишняя необязательная колонка). */
  blocking: boolean
}

export interface SchemaScreen {
  /** На сервере задан `DB_ADMIN_TOKEN`: кнопка «Выполнить» включена. */
  enabled: boolean
  steps: readonly StepView[]
}

export const SCHEMA_FORM_ID = 'db_schema_resolve'

/** Описание формы решений: секрет + по радиогруппе на каждый шаг с вариантами. */
export function schemaForm(screen: SchemaScreen) {
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
        validate: [v.required()],
      }),
    },
  })
}
