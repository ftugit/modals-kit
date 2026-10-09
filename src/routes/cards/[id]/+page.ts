import type { PageLoad } from './$types'

// Порт loader'а из src/routes/_app/(demo)/cards/$id.tsx оригинала:
// slow=1 — искусственная задержка, чтобы страница показала ожидание.
export const load: PageLoad = async ({ params, url }) => {
  if (url.searchParams.get('slow') === '1') {
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return {
    id: params.id,
    title: `Карточка №${params.id}`,
    body: `Содержимое карточки ${params.id}, отданное сервером. В модалке те же данные приходят через loader.`,
  }
}
