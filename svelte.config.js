import adapter from '@sveltejs/adapter-auto'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/**
 * Список адресов, которым разрешена межсайтовая отправка форм.
 *
 * Тот же источник, что читает `src/lib/server/form-security.ts` — переменная
 * `KIT_TRUSTED_ORIGINS`, через запятую. Разница одна: SvelteKit сравнивает
 * точной строкой (`csrf_trusted_origins.includes(origin)`), wildcard он не
 * понимает, поэтому записи с `*` сюда не едут — их разбирает слой 02.
 *
 * Зачем не `'*'`: `'*'` выключает проверку фреймворка у ВСЕГО
 * приложения и во всех сборках, включая прод. Проверка бесплатна, когда
 * известен публичный адрес, — значит перечисляем адреса, а не отключаем.
 */
const fromEnv = (process.env.KIT_TRUSTED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && !s.includes('*'))

/**
 * Превью песочницы: прокси обращается к `127.0.0.1:PORT` и подменяет `Host`,
 * из которого SvelteKit считает собственный origin. Без явного адреса браузер
 * получает 403 «Cross-site POST form submissions are forbidden» на каждую
 * форму. localhost в списке — тоже осознанно: межсайтовый атакующий приходит
 * со СВОИМ origin, а не с локального адреса.
 */
function localOrigins() {
  const ports = (process.env.PREVIEW_PORTS ?? '5173,5174')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sandbox = process.env.E2B_SANDBOX_ID
  return ports.flatMap((p) => [
    `http://localhost:${p}`,
    `http://127.0.0.1:${p}`,
    ...(sandbox ? [`https://${p}-${sandbox}.e2b.app`] : []),
  ])
}

const trustedOrigins = [...new Set([...fromEnv, ...localOrigins()])]

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csrf: { trustedOrigins },
  },
}
