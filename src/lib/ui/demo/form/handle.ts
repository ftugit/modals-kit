// Серверный приём через слои библиотеки.
//
// Метод, источник запроса, предел тела со счётчиком потока, проверка имён,
// конверт, описание, идемпотентность, частота, асинхронные проверки и
// обработчик ошибок — всё в одном конвейере. Приложение пишет только execute.
// Отдельная точка входа: серверные слои не должны попасть в браузерный бандл.
import {
  createFormHandler, MemoryIdempotencyStore, windowThrottle, type Handled,
} from '$lib/form/server'
import { applyOps, editor, groupRows, type FormDescription, type SchemaOp } from '$lib/form'
import './extend'
import { checks } from './extend'
import { resolveDescription, signup } from './signup'

const idempotency = new MemoryIdempotencyStore()
const throttle = windowThrottle({ limit: 30, windowMs: 60_000, key: () => 'demo' })

const created: string[] = []
export const createdCount = () => created.length

/**
 * Разворот описания по фактическому составу данных — серверная половина
 * операций клиента (README библиотеки: «тот же SchemaOp применяется в памяти
 * при перехвате и на сервере при нативной отправке»). Строка повторяемой
 * группы и пользовательское `u_`-поле приходят в теле, когда клиент уже
 * применил операции до отправки. Валидаторы строк — из СЕРВЕРНОГО шаблона
 * группы, клиент передаёт только ключ; `u_`-поля принимаются как значения
 * без серверной проверки: их правила живут в реестре клиента, постоянное
 * хранение — `createAppSource` с `UserFieldStore`.
 */
function expandFor(base: FormDescription, form: FormData | null): FormDescription {
  if (!form) return base
  const ops: SchemaOp[] = []
  const rows = new Set<string>()
  const groups = new Set(Object.keys(groupRows(base.fields)))
  let order = base.fields.length
  for (const key of form.keys()) {
    if (typeof key !== 'string' || base.byName[key]) continue
    const m = /^([a-z][a-z0-9_]*)\.([a-z0-9_]+)\./.exec(key)
    if (m && groups.has(m[1]!) && !rows.has(m[2]!)) {
      rows.add(m[2]!)
      ops.push(editor.addRow(m[1]!, m[2]!))
    } else if (key.startsWith('u_')) {
      ops.push(editor.add({
        name: key, kind: 'text', input: 'text', label: key,
        order: ++order, validators: [],
      }))
    }
  }
  return ops.length ? applyOps(base, ops) : base
}

function handlerFor(description: typeof signup) {
  return createFormHandler({
    description,
    checks,
    idempotency,
    throttle,
    async execute({ values, intent, commit }) {
      // служебные действия ничего не создают: набор полей меняет адаптер
      if (intent !== 'submit' && intent !== 'save-draft') { commit(); return {} }
      created.push(String(values['email']))
      commit()
      return { data: { email: values['email'] } }
    },
  })
}

export async function handleSignup(
  request: Request, from: 'action' | 'fetch',
): Promise<Handled> {
  // набор полей НЕ приходит от клиента: описание поднимается по конверту
  const probe = await request.clone().formData().catch(() => null)
  const description = resolveDescription(probe?.get('__form_id'), probe?.get('__form_spec'))
  if (!description)
    return {
      status: 400,
      result: {
        v: 1, formId: 'unknown', instance: 'unknown:new', from,
        submissionId: '00000000-0000-4000-8000-000000000000', revision: 0,
        values: {}, ok: false, status: 400, outcome: 'not-applied',
        errors: [{ id: '*:envelope.missing:0', code: 'envelope.missing',
                   message: 'Запрос отклонён: не хватает конверта', origin: 'server' }],
      },
    }
  let expanded: FormDescription
  try {
    expanded = expandFor(description, probe)
  } catch (error) {
    // Чужое тело не должно превращать превышение лимитов схемы в HTTP 500.
    return {
      status: 413,
      result: {
        v: 1, formId: description.id, instance: 'unknown:new', from,
        submissionId: '00000000-0000-4000-8000-000000000000', revision: description.revision,
        values: {}, ok: false, status: 413, outcome: 'not-applied',
        errors: [{ id: '*:request.too-large:0', code: 'request.too-large',
          message: 'Запрос содержит слишком много динамических полей', origin: 'server',
          params: { detail: error instanceof Error ? error.message : String(error) } }],
      },
    }
  }
  return handlerFor(expanded)(request, from)
}
