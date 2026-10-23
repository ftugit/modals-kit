// Настройки каркаса из cookie: сервер рисует ту же раскладку, что увидит
// клиент (B11). Cookie не создаёт зависимости load — на клиентских переходах
// load не перезапускается; изменения пишет сам ShellState.
import type { LayoutServerLoad } from './$types'
import { parseShellPrefs, SHELL_COOKIE } from '#lib/components/shell/prefs.js'
import { resolveVault } from '#content/user/gateway.js'

let serverAuthSeq = 0

export const load: LayoutServerLoad = async (event) => ({
  shell: parseShellPrefs(event.cookies.get(SHELL_COOKIE)) ?? null,
  // Оба токена — в HttpOnly-куках; если короткий `auth_tmp` истёк при живом
  // `auth_sid`, `resolveVault` бесшовно выпускает новую пару прямо на SSR,
  // отдавая на клиент только публичные метаданные (без сырого токена).
  user: await resolveVault(event),
  // Монотонный штамп реального серверного выполнения `+layout.server.ts`:
  // неизменен на клиентских переходах, но гарантированно меняется при любом
  // перезапуске серверного `load` (SSR, `invalidateAll`, нативный POST).
  authStamp: ++serverAuthSeq,
  // Одноразовый результат нативного POST встраиваемой формы на текущем маршруте.
  formResult: event.locals.formResult ?? null,
})
