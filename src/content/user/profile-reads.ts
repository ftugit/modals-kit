/**
 * Инвалидация читающих поверхностей после записи профиля.
 *
 * Сохранение профиля — мутация, а её результаты видны из нескольких
 * независимых кешей, и ни один сам не узнает о записи:
 *
 *  - кеш загрузчика модалок: запись `user.profile`, открытая до создания
 *    профиля, навсегда показывает «профиль не создан», а `user.list` —
 *    старый столбец никнеймов (лечится только перезагрузкой страницы);
 *  - кеш `load` маршрутов SvelteKit (`/user/[id]`, `/users`): те же данные
 *    для страничных носителей и для `preloadData`;
 *  - ячейка пагинатора `seed-users`: снапшот гидрирует стор один раз за
 *    сессию, поэтому свежий `load` списка строку уже не обновит.
 *
 * Поэтому форма профиля после успешного сохранения зовёт эту функцию —
 * по образцу смены сессии в `AuthModal.done()` (там `invalidateLoader()`
 * без аргументов), только точечно: профиль трогает ровно эти поверхности.
 * Ячейку пагинатора правим на месте (`patchItems`), а не сбросом: у
 * пользователя не должны мигать выдача, фильтры и позиция прокрутки.
 * Список ни разу не открывали — ячейки нет, и лишнего запроса не будет.
 */
import { invalidate } from '$app/navigation'
import { getClientStore, hasPaginator, patchItems } from '#lib/paginate/index.js'
import { SEED_USERS_NAME } from './ui/seed-users/source.js'
import type { SeedUserView } from './types.js'

/** Минимум контекста модалок, который нужен инвалидации. */
export interface ProfileReadsModals {
  invalidateLoader(name: string): void
}

export function invalidateProfileReads(input: {
  /** Контекст модалок, если форма живёт под хостом; на странице может не быть. */
  modals: ProfileReadsModals | null
  /** Чей профиль записан: свой — principal из `vault`, чужой — `subject` формы. */
  subjectId: string | null
  /**
   * Никнейм из формы, если он реально ушёл на сервер. `undefined` — поле
   * пустое (сервер пустой ник не записывает): строку списка не трогаем,
   * остальные поверхности всё равно инвалидируются — профиль мог создаться.
   */
  nickname?: string
}): void {
  input.modals?.invalidateLoader('user.profile')
  input.modals?.invalidateLoader('user.list')

  // Маршрутные `load`: профиль (`/user/<id>`, включая `/user/auth`) и список.
  void invalidate((url) => url.pathname === '/users' || url.pathname.startsWith('/user/')).catch(
    () => undefined,
  )

  const { subjectId, nickname } = input
  if (!subjectId || nickname === undefined) return
  // Пагинатор не зарегистрирован — список ни разу не рендерился, прави́л нет.
  if (!hasPaginator(SEED_USERS_NAME)) return
  const store = getClientStore()
  if (!store.isHydrated(SEED_USERS_NAME)) return
  const state = store.state<SeedUserView>(SEED_USERS_NAME)()
  for (const p of state.loadedPages) {
    const item = state.pages[p]?.find((it) => it.id === subjectId)
    if (!item) continue
    // Столбца никнейма в этой выдаче нет — не выдумываем его правкой.
    if (item.nickname === undefined) return
    patchItems<SeedUserView>(store, SEED_USERS_NAME, {
      update: { ...item, nickname },
    })
    return
  }
}
