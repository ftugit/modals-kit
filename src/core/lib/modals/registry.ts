// Реестр с ОБЛАСТЬЮ ВИДИМОСТИ.
//
// Почему не глобальная Map, как в оригинале. Там реестр был глобальным только
// по хранению, а по употреблению — уже привязан к роуту:
//   • <ModalHost> монтируется на СТРАНИЦЕ (свой в ModalsDemo, свой в
//     ShikimoriPage), а не один на приложение;
//   • registerModal() вызывается как побочный эффект импорта модуля страницы,
//     который грузится лениво;
//   • глобального импорта определений в проекте нет вообще.
//
// Отсюда три следствия, которые чинит область видимости:
//   1. имена обязаны быть уникальны на всё приложение, хотя нужны в пределах
//      роута — и коллизия «последний перезаписал» происходит МОЛЧА;
//   2. момент регистрации непредсказуем, поэтому понадобился registryVersion,
//      чтобы триггеры узнавали о поздней регистрации;
//   3. холодный запуск по ссылке работает лишь потому, что чанк, который
//      регистрирует, — тот же, что рисует хост. Совпадение, не гарантия.
//
// Порядок разрешения повторяет разрешение layout'ов в SvelteKit, чтобы
// не изобретать вторую модель: своя область → родительские → глобальная.
import type { ModalDefinition } from './types'

export type AnyDefinition = ModalDefinition<any, any, any>

export interface ResolveHit {
  definition: AnyDefinition
  /** Имя области, в которой нашлось, — для диагностики. */
  scope: string
}

/**
 * Область видимости модалок. Обычно одна на роут; ссылается на родительскую
 * (layout) и так далее до глобальной.
 */
export interface ModalRegistry {
  readonly name: string
  readonly parent: ModalRegistry | null
  /** Объявить модалки этой области. Повтор имени в одной области — ошибка. */
  define(input: AnyDefinition[] | Record<string, AnyDefinition>): ModalRegistry
  /** Есть ли имя ИМЕННО здесь (без подъёма к родителю). */
  own(name: string): AnyDefinition | undefined
  /** Имена, объявленные ИМЕННО здесь. */
  ownNames(): string[]
  /** Разрешение с подъёмом: своя область → родитель → … → глобальная. */
  resolve(name: string): ResolveHit | undefined
  /** Функция-lookup для ядра и транспорта. */
  readonly lookup: (name: string) => AnyDefinition | undefined
  /** Имена, видимые отсюда; ближние перекрывают дальние. */
  visible(): string[]
  /** Цепочка областей от своей до глобальной — для сообщений. */
  chainOfScopes(): string[]
  /** Дочерняя область (роут внутри layout-а). */
  child(name: string): ModalRegistry
  /** Только для тестов. */
  clear(): void
}

/**
 * Фабрика, а не класс — как весь `lib/` проекта: там 20 функций `create*`
 * и ни одного класса состояния (классы только для подклассов `Error`).
 */
export function createRegistry(name: string, parent: ModalRegistry | null = null): ModalRegistry {
  const defs = new Map<string, AnyDefinition>()

  const api: ModalRegistry = {
    name,
    parent,

    /**
     * Объявить модалки этой области.
     *
     * Повторное объявление ОДНОГО И ТОГО ЖЕ имени в ОДНОЙ области — ошибка:
     * в оригинале это молча перезаписывало определение.
     */
    define(input: AnyDefinition[] | Record<string, AnyDefinition>) {
      const list = Array.isArray(input) ? input : Object.values(input)
      for (const def of list) {
        const existing = defs.get(def.name)
        if (existing && existing !== def) {
          throw new Error(
            `[modals] «${def.name}» уже объявлена в области «${name}». ` +
              'Имя должно быть уникально внутри области; ' +
              'для одноимённой модалки другого роута заведите её в СВОЕЙ области — ' +
              'перекрытие родительской разрешено и работает как у layout-ов.',
          )
        }
        defs.set(def.name, def)
      }
      return api
    },

    /** Есть ли имя ИМЕННО здесь (без подъёма к родителю). */
    own: (n) => defs.get(n),

    /** Имена, объявленные ИМЕННО здесь. */
    ownNames: () => [...defs.keys()],

    /** Разрешение с подъёмом: своя область → родитель → … → глобальная. */
    resolve(n: string): ResolveHit | undefined {
      let scope: ModalRegistry | null = api
      while (scope) {
        const definition = scope.own(n)
        if (definition) return { definition, scope: scope.name }
        scope = scope.parent
      }
      return undefined
    },

    /** Функция-lookup для ядра и транспорта (кодек адреса ждёт именно её). */
    get lookup(): (n: string) => AnyDefinition | undefined {
      return (n) => api.resolve(n)?.definition
    },

    /** Имена, видимые отсюда, — ближние перекрывают дальние. */
    visible(): string[] {
      const seen = new Set<string>()
      let scope: ModalRegistry | null = api
      while (scope) {
        for (const n of scope.ownNames()) seen.add(n)
        scope = scope.parent
      }
      return [...seen].sort()
    },

    /** Цепочка областей от своей до глобальной — для сообщений. */
    chainOfScopes(): string[] {
      const out: string[] = []
      let scope: ModalRegistry | null = api
      while (scope) {
        out.push(scope.name)
        scope = scope.parent
      }
      return out
    },

    /** Дочерняя область (роут внутри layout-а). */
    child: (n) => createRegistry(n, api),

    /** Только для тестов. */
    clear: () => defs.clear(),
  }

  return api
}


/* ── глобальная область ────────────────────────────────────────────── */

/**
 * Модалки, доступные отовсюду: авторизация, настройки, подтверждение —
 * то, что открывается из шапки на любом роуте. Всё остальное должно жить
 * в области своего роута.
 */
export const globalScope = createRegistry('global')

/** Совместимость с оригиналом: регистрация в глобальной области. */
export function registerModal(definition: AnyDefinition): string {
  globalScope.define([definition])
  return definition.name
}

/* ── диагностика ───────────────────────────────────────────────────── */

/**
 * Сообщение о ненайденном имени. Оригинал говорил только «Нет такой модалки»;
 * при областях можно сказать, ГДЕ искали и где имя всё-таки есть — иначе
 * область видимости превращается в источник загадочных ошибок.
 */
export function explainMissing(
  name: string,
  scope: ModalRegistry,
  others: readonly ModalRegistry[] = [],
): string {
  const where = scope.chainOfScopes().join(' → ')
  const elsewhere = others.filter((s) => s.own(name)).map((s) => s.name)

  const lines = [`Нет модалки «${name}».`, `Искали в областях: ${where}.`]

  if (elsewhere.length > 0) {
    lines.push(
      `Такое имя объявлено в: ${elsewhere.join(', ')} — эта область отсюда не видна.`,
      'Либо перенесите объявление в общего родителя, либо объявите её здесь.',
    )
  } else {
    const visible = scope.visible()
    lines.push(
      visible.length > 0 ? `Здесь доступны: ${visible.join(', ')}.` : 'Здесь не объявлено ни одной.',
    )
  }

  return lines.join(' ')
}
