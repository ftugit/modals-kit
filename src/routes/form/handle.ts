// Серверный приём через слои библиотеки.
//
// Метод, источник запроса, предел тела со счётчиком потока, проверка имён,
// конверт, описание, идемпотентность, частота, асинхронные проверки и
// обработчик ошибок — всё в одном конвейере. Приложение пишет только execute.
// Отдельная точка входа: серверные слои не должны попасть в браузерный бандл.
import {
  createFormHandler, MemoryIdempotencyStore, windowThrottle, type Handled,
} from '$lib/form/server'
import './extend'
import { checks } from './extend'
import { resolveDescription, signup } from './signup'

const idempotency = new MemoryIdempotencyStore()
const throttle = windowThrottle({ limit: 30, windowMs: 60_000, key: () => 'demo' })

const created: string[] = []
export const createdCount = () => created.length

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
  return handlerFor(description)(request, from)
}
