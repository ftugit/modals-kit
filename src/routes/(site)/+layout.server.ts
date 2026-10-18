// Настройки каркаса из cookie: сервер рисует ту же раскладку, что увидит
// клиент (B11). Cookie не создаёт зависимости load — на клиентских переходах
// load не перезапускается; изменения пишет сам ShellState.
import type { LayoutServerLoad } from './$types'
import { parseShellPrefs, SHELL_COOKIE } from '#lib/components/shell/prefs.js'
import { readVault } from '#content/user/gateway.js'

export const load: LayoutServerLoad = async ({ cookies }) => ({
  shell: parseShellPrefs(cookies.get(SHELL_COOKIE)) ?? null,
  // Токены — в HttpOnly-куках; сюда — только витрина для UserMenu и RAM vault.
  // Без AUTH_SEAL_SECRET (dev/e2e без секрета) — просто не залогинен, не падаем.
  user: await readVault(cookies).catch(() => null),
})
