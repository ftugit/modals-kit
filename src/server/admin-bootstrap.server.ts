// Первый администратор: создаётся один раз, когда схема БД появилась.
//
// Зачем: без записи с правом `admin` систему некому настраивать — права
// выдаёт только администратор (`admin.ts`), а выдать их некому. Поэтому после
// сверки схемы проверяем: есть ли хоть одна строка `user_auth` с `admin` в
// правах; нет — заводим.
//
// Ключи генерируются здесь же (`keys.ts`, Ed25519): в базе остаётся `seed`
// (публичная половина), а `secret` печатается один раз в консоль сервера —
// его вставляют в поле «Seed» формы входа. Хранить secret сервер не может и
// не должен: это ключ владельца.
//
// Повторный запуск ничего не создаёт: в памяти (`DATABASE_DIR` не задан) база
// пустая, поэтому администратор появится заново при каждом старте, а на
// постоянной базе — только один раз.
import type { Database } from '#lib/db/index.js'
import { SERVER } from '#content/user/auth.js'
import { generateKeyPair } from '#content/user/keys.js'
import { ADMIN_ROLE } from '#content/user/permissions.js'
// модель, а не `db.server.ts`: иначе получился бы цикл (db.server его импортирует)
import { auth } from '#content/user/schema.js'

/** Что создано — для теста и для консоли. */
export interface SeedAdmin {
  readonly id: string
  /** Публичная половина («логин») — она и лежит в БД. */
  readonly seed: string
  /** Приватная половина: показывается в консоли, в БД не попадает. */
  readonly secret: string
}

const hasAdmin = (rows: readonly unknown[]): boolean =>
  rows.some((row) => {
    const list = (row as { permissions?: unknown }).permissions
    return Array.isArray(list) && list.includes(ADMIN_ROLE)
  })

/**
 * Завести администратора, если его ещё нет. Возвращает созданного (или `null`,
 * если администратор уже был). Ошибку не глотает: решение принимает вызывающий.
 */
export async function ensureSeedAdmin(db: Database): Promise<SeedAdmin | null> {
  const auths = db.resource(auth)
  const existing = await auths.select(SERVER, {})
  if (hasAdmin(existing)) return null

  const pair = await generateKeyPair()
  const row = (await auths.insert(SERVER, {
    seed: pair.seed,
    permissions: [ADMIN_ROLE],
  })) as unknown as { id: string }

  return { id: row.id, seed: pair.seed, secret: pair.secret }
}

/**
 * Печать в консоль сервера. `secret` — единственный раз и только здесь:
 * в лог приложения он больше не попадает никогда.
 */
export function announceSeedAdmin(admin: SeedAdmin): void {
  console.info(
    [
      '',
      '[user] администратор создан',
      `[user]   seed (в базе):        ${admin.seed}`,
      `[user]   ключ для входа:      ${admin.secret}`,
      '[user]   вставьте ключ в поле «Seed» на странице входа — он больше не покажется',
      '',
    ].join('\n'),
  )
}
