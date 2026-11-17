/**
 * Типизированная карта возможностей страницы (P2-3).
 *
 * До этого флаги прав объявлялись дважды и независимо: доменная функция
 * (`capsOf` в `sessions.server.ts`, объект `caps` в `profile.ts`) возвращала
 * один набор булевых флагов, а route data (`SessionsRouteData`, `ProfileRead`,
 * `ProfileRouteData`) объявляла свой. Переименование или удаление флага в
 * домене не ломало компиляцию route data — расхождение всплывало только в
 * рантайме (кнопка есть, права нет, или наоборот).
 *
 * `PageCapsMap` — один источник истины: какие флаги есть у страницы и какого
 * они типа. Домен производит их через `defineCaps<R>` (объектный литерал
 * проверяется на лишние/пропущенные/неверные флаги), route data наследует тот
 * же `PageCaps<R>`. Разойтись они не могут: обе стороны ссылаются на одну карту,
 * а `defineCaps` не даёт домену объявить флаг, которого в карте нет.
 */

/**
 * Карта возможностей по ключу страницы/ресурса. Только булевы флаги прав
 * зрителя; данные показа (`fullBlock`, `blocks`, `visibility`, снапшот) живут
 * в route data отдельно и в карту не входят.
 */
export interface PageCapsMap {
  /**
   * Круг прав на срез устройств — выход `capsOf(actor, ownerId)` в
   * `sessions.server.ts`. `canRead` — чтение круга (владелец или журнал);
   * в route data он публикуется как `canReadOthers` (круг журнала), остальные
   * четыре флага едут в срез как есть (`SessionSliceCaps`).
   */
  sessions: {
    canRead: boolean
    canSeeDeleted: boolean
    canRename: boolean
    canRevoke: boolean
    canHardDelete: boolean
  }
  /**
   * Возможности зрителя на профиле — выход `profile()` в `profile.ts`.
   * `canOpenConfig` необязателен исторически (носители добирают умолчанием),
   * домен его всегда заполняет.
   */
  profile: {
    /** Править профиль (владелец или `profile.edit`/`admin`): кнопка и гейт. */
    canEdit: boolean
    /**
     * Удалить профиль: право (`profile.edit`/владелец) и нет активного запрета
     * `profile.delete` на цели. Запрет цели сильнее любого права.
     */
    canDeleteProfile: boolean
    /** То же для seed-аккаунта: `account.edit`/владелец и нет запрета `account.delete`. */
    canDeleteSeed: boolean
    /** Видеть раздел блокировок (круг чтения блока). */
    canReadBlocks: boolean
    /** Накладывать и снимать блокировки. */
    canBlock: boolean
    /** Читать чужие устройства: кнопка «Сессии» чужого профиля. */
    canReadSessions: boolean
    /** Открыть экран настроек пользователя (`user.config.edit`); носители добирают умолчанием. */
    canOpenConfig?: boolean
    /** Вызывающий — сам владелец цели (блок приватности показывается только ему). */
    isOwn: boolean
  }
}

/** Возможности страницы `R` — одна карта на домен и route data. */
export type PageCaps<R extends keyof PageCapsMap> = PageCapsMap[R]

/**
 * Флаги среза устройств, которые едут в UI: всё из `PageCaps<'sessions'>`,
 * кроме `canRead` (он публикуется отдельно как `canReadOthers` — круг журнала).
 */
export type SessionSliceCaps = Omit<PageCaps<'sessions'>, 'canRead'>

/**
 * Проверяет объектный литерал флагов против карты: лишний флаг, пропущенный
 * обязательный флаг или неверный тип — ошибка компиляции. Возвращает тот же
 * объект с типом `PageCaps<R>`, чтобы домен и route data делили один тип.
 *
 * ```ts
 * const caps = defineCaps<'sessions'>({ canRead, canSeeDeleted, canRename, canRevoke, canHardDelete })
 * ```
 */
export function defineCaps<R extends keyof PageCapsMap>(caps: PageCaps<R>): PageCaps<R> {
  return caps
}
