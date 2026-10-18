/**
 * Профильный api модуля user: публичные данные аккаунта (никнейм, адрес
 * аватара). Отдельно от `auth.ts` — у auth профильных функций нет (чек-лист
 * §6: «откуда у auth profile?»); права здесь те же — сессия (`guard`).
 */
import { fail, guard, ok, type UserResult } from './auth.js'
import type { AuthFact } from './error.js'
import type { AuthPorts } from './ports.js'
import type { ProfileView } from './types.js'

/** Свой профиль: есть строка — её значения; `null` — аноним (нулевые дефолты). */
export async function profile(
  ports: AuthPorts,
  accessToken: string | undefined,
): Promise<UserResult<ProfileView | null>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  const row = await ports.profiles.get(g.sub)
  if (!row) return ok(null)
  return ok(row)
}

/**
 * Сохранить профиль. ПЕРВОЕ заполнение создаёт строку. Никнейм проверяется на
 * запрещённые (`config.nicknameForbidden`); формат и вес аватара — по конфигу
 * (белый список base64-форматов, предел байт). Правила длины/вида значений —
 * на записи проверит схема (`lib/db`), здесь — доменные запреты.
 */
export async function updateProfile(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { nickname?: string; avatarUrl?: string | null },
): Promise<UserResult<ProfileView>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  let nickname: string | undefined
  if (args.nickname !== undefined) {
    nickname = args.nickname.trim()
    if (nickname.length < 2 || nickname.length > 32)
      return fail({ code: 'profile.nickname-forbidden' })
    const forbidden = await ports.config.get('nicknameForbidden')
    const lower = nickname.toLowerCase()
    if (forbidden.some((n) => n.toLowerCase() === lower))
      return fail({ code: 'profile.nickname-forbidden' })
  }

  let avatarUrl: string | null | undefined
  if (args.avatarUrl !== undefined) {
    if (args.avatarUrl === null) {
      avatarUrl = null
    } else {
      const verdict = await checkAvatar(ports, args.avatarUrl)
      if (verdict) return fail(verdict)
      avatarUrl = args.avatarUrl
    }
  }

  const existing = await ports.profiles.get(g.sub)
  if (!existing) {
    await ports.profiles.create(g.sub, {
      ...(nickname !== undefined ? { nickname } : {}),
      ...(avatarUrl !== undefined && avatarUrl !== null ? { avatarUrl } : {}),
    })
  } else {
    await ports.profiles.update(g.sub, {
      ...(nickname !== undefined ? { nickname } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    })
  }
  const row = await ports.profiles.get(g.sub)
  return ok(row as ProfileView)
}

/** Доменная проверка аватара: белый список форматов и предел веса из конфига. */
async function checkAvatar(ports: AuthPorts, value: string): Promise<AuthFact | undefined> {
  const formats = await ports.config.get('avatarFormats')
  const maxBytes = await ports.config.get('avatarMaxBytes')
  const names = formats.join('|')
  const pattern = new RegExp(`^data:image/(?:${names});base64,[A-Za-z0-9+/]+={0,2}$`)
  if (!pattern.test(value)) return { code: 'profile.avatar-format' }
  // вес считаем от содержимого (после запятой): клиент сжимает БАЙТЫ КАРТИНКИ,
  // а префикс `data:image/jpeg;base64,` — ~30 Б, из-за них «впритык» сжатое
  // отбраковывалось (ход 261, репорт владельца «не сохранялось с нескольких раз»)
  const base64 = value.slice(value.indexOf(',') + 1)
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  if (bytes > maxBytes) return { code: 'profile.avatar-size', args: { max: maxBytes } }
  return undefined
}
