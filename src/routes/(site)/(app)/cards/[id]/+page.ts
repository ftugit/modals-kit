import { error, redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

// Порт loader'а из src/routes/_app/(demo)/cards/$id.tsx оригинала:
// slow=1 — искусственная задержка, чтобы страница показала ожидание.
export const load: PageLoad = async ({ params, url }) => {
  if (url.searchParams.get('slow') === '1') {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  // Демо-ручки для Link (бывший LoadLink, C4): исход загрузчика, который ссылка обязана
  // различать, — ошибка (`status ≥ 400` в ответе preloadData) и штатная
  // переадресация (`type: 'redirect'`).
  if (url.searchParams.get('fail') === '1') {
    error(404, `Карточки ${params.id} нет (демо)`)
  }
  if (url.searchParams.get('moved') === '1') {
    redirect(307, `/cards/${params.id}`)
  }
  return {
    id: params.id,
    title: `Карточка №${params.id}`,
    body: `Содержимое карточки ${params.id}, отданное сервером. В модалке те же данные приходят через loader.`,
  }
}
