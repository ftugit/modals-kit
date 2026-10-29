/**
 * Реактивный переходник между чистой алгеброй прав `#lib/db` (`grants`, `checkGrants`, `forOwner`)
 * и произвольным источником текущей сессии (`createUseGrants`).
 *
 * По границе `tooling/layer-guard.mjs` хук живёт в `src/hooks/` и не импортирует
 * `src/content/*`: модуль пользователя связывает его со своим `vault` в три строки
 * (`src/content/user/grants.svelte.ts`).
 */
import {
  checkGrants,
  isGrantSpecInput,
  type GrantActor,
  type GrantSpec,
} from '#lib/db/index.js'

export interface UseGrantsOptions {
  /**
   * Владелец целевой записи для маркера `'owner'`: строка или реактивный геттер `() => uid`
   * (чтобы не терять реактивность `$props()` в Svelte 5).
   */
  readonly ownerId?: string | null | undefined | (() => string | null | undefined)
  /**
   * Явный проверяемый субъект вместо текущего авторизованного пользователя
   * (например строка чужого пользователя `{ id, permissions }` в списке аккаунтов
   * или живое превью на форме выдачи прав).
   */
  readonly actor?: GrantActor | null | undefined | (() => GrantActor | null | undefined)
  /** Поведение на неразмеченном правиле `null` (по умолчанию `false`). */
  readonly onUnknown?: boolean
}

export interface ReactiveGrantFlag {
  readonly current: boolean
}

export type UseGrantsFn = {
  /**
   * Одиночное требование `GrantSpec` (массив ролей `['admin', 'test']`, правило модели
   * `grants(auth).select`, составная межмодельная связка `[grants(a).select, grants(b).insert]`
   * или реактивный геттер `() => spec`). Возвращает `{ readonly current: boolean }`.
   */
  (spec: GrantSpec | (() => GrantSpec), options?: UseGrantsOptions): ReactiveGrantFlag

  /**
   * Словарь именованных проверок (`grants(block)`, `configRow.schema` или объект
   * `{ create: gBlock.insert, pickUsers: [gAuth.select, gBlock.insert] }`).
   * Возвращает объект с реактивными геттерами `{ readonly [K]: boolean }`.
   */
  <T extends Record<string, GrantSpec>>(
    specMap: T,
    options?: UseGrantsOptions,
  ): { readonly [K in keyof T]: boolean }
}

const resolveMaybeGetter = <V>(v: V | (() => V)): V =>
  typeof v === 'function' ? (v as () => V)() : v

/**
 * Создаёт реактивный хук `useGrants`, по умолчанию читающий субъекта из `getDefaultActor()`,
 * с поддержкой переопределения `actor` и `ownerId` на лету.
 */
export function createUseGrants(getDefaultActor: () => GrantActor | null): UseGrantsFn {
  function resolveActor(options?: UseGrantsOptions): GrantActor | null {
    if (options && 'actor' in options && options.actor !== undefined) {
      return resolveMaybeGetter(options.actor) ?? null
    }
    return getDefaultActor()
  }

  function resolveOwnerId(options?: UseGrantsOptions): string | null {
    if (!options || options.ownerId === undefined) return null
    return resolveMaybeGetter(options.ownerId) ?? null
  }

  function useGrantsImpl(
    specOrMap: GrantSpec | (() => GrantSpec) | Record<string, GrantSpec>,
    options?: UseGrantsOptions,
  ): ReactiveGrantFlag | Record<string, boolean> {
    if (typeof specOrMap === 'function' || isGrantSpecInput(specOrMap)) {
      const flag: ReactiveGrantFlag = {
        get current(): boolean {
          const currentSpec = typeof specOrMap === 'function' ? specOrMap() : specOrMap
          return checkGrants(resolveActor(options), currentSpec, {
            ownerId: resolveOwnerId(options),
            onUnknown: options?.onUnknown,
          })
        },
      }
      return Object.freeze(flag)
    }

    const out: Record<string, boolean> = {}
    for (const key of Object.keys(specOrMap)) {
      Object.defineProperty(out, key, {
        enumerable: true,
        configurable: false,
        get(): boolean {
          return checkGrants(resolveActor(options), specOrMap[key], {
            ownerId: resolveOwnerId(options),
            onUnknown: options?.onUnknown,
          })
        },
      })
    }
    return Object.freeze(out)
  }

  return useGrantsImpl as UseGrantsFn
}
