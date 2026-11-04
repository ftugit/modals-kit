// Настройки каркаса из cookie: сервер рисует ту же раскладку, что увидит
// клиент (B11). Cookie не создаёт зависимости load — на клиентских переходах
// load не перезапускается; изменения пишет сам ShellState.
import { randomUUID } from 'node:crypto'
import type { LayoutServerLoad } from './$types'
import { parseShellPrefs, SHELL_COOKIE } from '#components/shell/prefs.js'
import { resolveVault } from '#content/user/gateway.server.js'

export const load: LayoutServerLoad = async (event) => ({
  shell: parseShellPrefs(event.cookies.get(SHELL_COOKIE)) ?? null,
  // Оба токена — в HttpOnly-куках; если короткий `auth_tmp` истёк при живом
  // `auth_sid`, `resolveVault` бесшовно выпускает новую пару прямо на SSR,
  // отдавая на клиент только публичные метаданные (без сырого токена).
  user: await resolveVault(event),
  // Уникальный маркер выполнения, в том числе при разных инстансах и рестартах.
  // Сравнивается только на равенство, не задаёт порядок конкурентных ответов.
  authStamp: randomUUID(),
  // Одноразовый результат нативного POST встраиваемой формы на текущем маршруте.
  formResult: event.locals.formResult ?? null,
})
