import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { canonicalPaginatorSearch } from '$lib/paginate'
import {
  DEMO_EXTRA_SEARCH,
  GALLERY_EXTRA_SEARCH,
  GALLERY_PAGE_PARAM,
} from '../../features/paginator/definition'
import { loadPaginatorDemo } from '../../features/paginator/loader'

export const load: PageServerLoad = async ({ url }) => {
  /**
   * Канонический адрес (указание владельца 2026-10-07: GET остаётся, но «списка
   * пустых полей» в адресе быть не должно). Нативная форма отправляет все свои
   * контролы: после «Применить» без JavaScript в адрес попадали `page.filters.status=`,
   * `page.filters.rating=` и прочие незаполненные поля. Пустое значение для слоя
   * тождественно отсутствию ключа, поэтому такой адрес приводится к каноническому
   * здесь — на входе, а не подменой полей в разметке (без JS форму «подкручивать»
   * нечем: безымянный или выключенный контрол браузер не отправит, и ввод пропал
   * бы молча). Переадресация ровно одна и только когда есть что убирать; ключи со
   * значениями, чужие ключи второго пагинатора и ненаши ключи остаются.
   */
  const canonical = canonicalPaginatorSearch(
    [
      { pageParam: 'page', extra: DEMO_EXTRA_SEARCH },
      { pageParam: GALLERY_PAGE_PARAM, extra: GALLERY_EXTRA_SEARCH },
    ],
    url.searchParams,
  )
  if (canonical) {
    const query = canonical.toString()
    redirect(307, `${url.pathname}${query ? `?${query}` : ''}`)
  }

  const loaderData = await loadPaginatorDemo({ url })
  return { loaderData }
}
