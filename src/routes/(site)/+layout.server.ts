// Настройки каркаса из cookie: сервер рисует ту же раскладку, что увидит
// клиент (B11). Cookie не создаёт зависимости load — на клиентских переходах
// load не перезапускается; изменения пишет сам ShellState.
import type { LayoutServerLoad } from './$types'
import { parseShellPrefs, SHELL_COOKIE } from '#lib/shell/prefs.js'

export const load: LayoutServerLoad = ({ cookies }) => ({
  shell: parseShellPrefs(cookies.get(SHELL_COOKIE)) ?? null,
})
