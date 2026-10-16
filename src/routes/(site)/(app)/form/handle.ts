// Серверный приём через слои библиотеки.
//
// Метод, источник запроса, предел тела со счётчиком потока, проверка имён,
// конверт, описание, идемпотентность, частота, асинхронные проверки и
// обработчик ошибок — всё в одном конвейере. Приложение пишет только execute.
// Отдельная точка входа: серверные слои не должны попасть в браузерный бандл.
import type { RequestEvent } from '@sveltejs/kit'
import {
  createFormHandler, storeIdempotency, windowThrottle, type Handled,
} from '#lib/form/server.js'
import { localStore } from '#lib/server/cache.js'
import { SECURITY_LAYERS } from '#lib/server/form-security.js'
import '#lib/components/form/extend.js'
import { checks } from '#lib/components/form/extend.js'
import { resolveDescription, signup } from './signup'

// Бронь отправки — в памяти процесса: этой форме база не нужна, и общая бронь
// сделала бы сервер БД её единственной зависимостью (см. `#lib/server/cache.ts`).
// Потолок — с запасом на отправки за сутки (срок брони и результата).
const idempotency = storeIdempotency(localStore.scope('demo-form:idempotency', { max: 10_000 }))
// Лимит — на адрес клиента (F18): `getClientAddress()` учитывает настройки
// адаптера (ADDRESS_HEADER/XFF_DEPTH), сырой x-forwarded-for не читается.
// Маршрут обязан передать event: без него ключ бросает, а не сводит всех в одно окно.
// Окна — в области `localStore` с потолком: адресов за минуту может быть сколько
// угодно, а память процесса — нет (у встроенной карты ограничителя потолка нет).
// 10 000 окон × ≤30 меток — сотни КБ; вытесняется давно не писавший адрес.
const throttle = windowThrottle<RequestEvent>({
  limit: 30, windowMs: 60_000,
  key: (_request, event) => event!.getClientAddress(),
  store: localStore.scope('demo-form:throttle', { max: 10_000 }),
})

// Счётчик созданных — число, а не список адресов: список рос без предела и держал
// в памяти введённые email.
const demo = localStore.scope('demo-form:stats', { max: 16 })
export const createdCount = (): number => demo.get<number>('created') ?? 0

const handler = createFormHandler<unknown, RequestEvent>({
  description: signup,
  // Режим ошибок — версия описания из конверта (`__form_spec`): страница, открытая до
  // переключения, получит своё описание. Тело запроса до слоёв не читается.
  source: { resolve: async (ctx) => resolveDescription(ctx.specVersion), revision: async () => signup.revision },
  // Слой 02 (origin) включён проектом, а не оставляется на волю маршрута:
  // «забыл указать origin» иначе означает «принимаем межсайтовый POST».
  order: SECURITY_LAYERS,
  checks,
  idempotency,
  throttle,
  async execute({ values, commit }) {
    demo.incr('created', Infinity)
    commit()
    return { data: { email: values['email'] } }
  },
})

export const handleSignup = (request: Request, from: 'action' | 'fetch', event: RequestEvent): Promise<Handled> =>
  handler(request, from, event)
