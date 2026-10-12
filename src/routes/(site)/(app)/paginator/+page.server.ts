import type { PageServerLoad } from './$types'
import { loadPaginatorDemo } from '#lib/ui/demo/paginator/loader.js'

/**
 * Загрузка демонстрации пагинатора. Адрес здесь НЕ правится: пустые ключи
 * нативной формы убирает клиент заменой записи истории (`syncAddress` в
 * `#lib/router/sveltekit.ts`, шаг на привязке роутера в URL-адаптере) — без
 * переадресации и без лишнего перехода, а без JavaScript шага нет вовсе:
 * пустое значение для слоя тождественно отсутствию ключа (решение владельца
 * 2026-10-08: «если очистка url не будет требовать редиректа, то очищай»).
 */
export const load: PageServerLoad = async ({ url, isDataRequest }) => {
  // Переход внутри сайта — без схемы фильтров: она в памяти вкладки (loader.ts).
  const loaderData = await loadPaginatorDemo({ url, isDataRequest })
  return { loaderData }
}
