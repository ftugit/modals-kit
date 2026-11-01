// Первый администратор: создаётся один раз, когда схема БД появилась.
//
// Зачем: без записи с правом `admin` систему некому настраивать — права
// выдаёт только администратор (`admin.ts`), а выдать их некому. Поэтому после
// сверки схемы проверяем: есть ли хоть одна живая строка `user_auth` с `admin`
// в правах; нет — заводим.
//
// Ключи генерируются здесь же (`keys.ts`, Ed25519): в базе остаётся `seed`
// (публичная половина), а `secret` печатается один раз в консоль сервера —
// его вставляют в поле «Seed» формы входа. Хранить secret сервер не может и
// не должен: это ключ владельца.
//
// Если задан `ADMIN_SEED` (ключ владельца из окружения), связка не
// генерируется: из него выводится `seed`, и вход тем же значением работает
// от запуска к запуску — без выхватывания строки из лога.
//
// Повторный запуск ничего не создаёт: в памяти (`DATABASE_DIR` не задан) база
// пустая, поэтому администратор появится заново при каждом старте, а на
// постоянной базе — только один раз при первом открытии драйвера в рантайме.
// Уже заведённого администратора `ADMIN_SEED` не заменяет.
import type { Database } from '#lib/db/index.js'
import { SERVER } from '#content/user/auth.js'
import { generateKeyPair, seedOf } from '#content/user/keys.js'
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

/**
 * Завести администратора, если его ещё нет. Возвращает созданного (или `null`,
 * если администратор уже был). Ошибку не глотает: решение принимает вызывающий.
 *
 * Проверка идёт прямым `SELECT 1 ... LIMIT 1` по всей таблице `public.user_auth`,
 * а не через `auths.select(SERVER, {})` с дефолтным `pageSize: 20`: при наличии
 * 100 демо-аккаунтов со случайными UUID постраничная выборка первых 20 строк
 * пропустила бы существующего администратора и плодила бы дубликаты.
 */
export async function ensureSeedAdmin(
  db: Database,
  secret?: string,
): Promise<SeedAdmin | null> {
  const { rows } = await db.query({
    text: 'SELECT 1 FROM public.user_auth WHERE deleted_at IS NULL AND $1 = ANY(permissions) LIMIT 1',
    values: [ADMIN_ROLE],
  })
  if (rows.length > 0) return null

  // Ключ из окружения (`ADMIN_SEED`) — чтобы вход не зависел от выхваченной
  // строки лога: публичный seed выводим из него, в БД по-прежнему только seed.
  const pair = secret ? { secret, seed: await seedOf(secret) } : await generateKeyPair()

  return db.transaction(async (tx) => {
    const activeAdmins = await tx.query({
      text: 'SELECT 1 FROM public.user_auth WHERE deleted_at IS NULL AND $1 = ANY(permissions) LIMIT 1',
      values: [ADMIN_ROLE],
    })
    if (activeAdmins.rows.length > 0) return null

    // Если строка с этим `seed` уже есть в `public.user_auth` (например, обычный
    // аккаунт без `admin` или мягко удалённый аккаунт с тем же `ADMIN_SEED`),
    // восстанавливаем её и выдаём роль `admin` без падения по `UNIQUE (seed)`.
    const existing = await tx.query<{ id: string }>({
      text: `UPDATE public.user_auth
                SET deleted_at = NULL,
                    permissions = CASE
                      WHEN $2 = ANY(permissions) THEN permissions
                      ELSE array_append(permissions, $2)
                    END,
                    updated_at = clock_timestamp()
              WHERE seed = $1
          RETURNING id`,
      values: [pair.seed, ADMIN_ROLE],
    })
    if (existing.rows.length > 0) {
      return { id: existing.rows[0]!.id, seed: pair.seed, secret: pair.secret }
    }

    const auths = tx.resource(auth)
    const row = (await auths.insert(SERVER, {
      seed: pair.seed,
      permissions: [ADMIN_ROLE],
    })) as unknown as { id: string }

    return { id: row.id, seed: pair.seed, secret: pair.secret }
  })
}

/**
 * Печать в консоль сервера или сборки. `secret` — единственный раз и только здесь:
 * в лог приложения он больше не попадает никогда. Без ведущей пустой строки, чтобы
 * в Vercel Build / Runtime Logs заголовок был виден сразу без сворачивания в пустоту.
 *
 * `source` — откуда взят ключ: сгенерированный печатаем целиком (иначе он потерян),
 * заданный через `ADMIN_SEED` только подтверждаем — его и так знает тот, кто задал.
 */
export function announceSeedAdmin(admin: SeedAdmin, source: 'generated' | 'env'): void {
  console.log(
    source === 'env'
      ? [
          '[user] администратор создан',
          `[user]   seed (в базе):        ${admin.seed}`,
          '[user]   ключ взят из ADMIN_SEED — в поле «Seed» вставляется значение этой переменной',
        ].join('\n')
      : [
          '[user] администратор создан',
          `[user]   seed (в базе):        ${admin.seed}`,
          `[user]   ключ для входа:      ${admin.secret}`,
          '[user]   вставьте ключ в поле «Seed» на странице входа — он больше не покажется',
        ].join('\n'),
  )
}
