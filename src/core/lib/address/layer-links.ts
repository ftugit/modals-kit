/**
 * Связки записей истории «слой → запись под ним» (ход 106) — чистое ядро, без
 * фреймворка и без `window`: среда подставляется.
 *
 * Зачем. Слой (модалка, список селекта на узком экране, мобильная панель) —
 * своя запись истории поверх записи страницы. Адрес страницы, изменённый,
 * пока слой открыт, ложится в запись слоя. Когда слой закрывает само
 * приложение (свой шаг назад), писатель знает, что это закрытие, и переносит
 * адрес на запись под слоем (`address.ts`). На системный «Назад» (браузера,
 * Android) такого знания нет: история говорит только «ушли с X на Y». Связки
 * отвечают на вопрос «X и Y — из одной стопки слоёв?»:
 *  • назад со слоя на запись под ним — переносим (изменения под модалкой живут);
 *  • вперёд с записи на её слой — переносим (слой открывается с текущими
 *    настройками страницы, а не с устаревшими);
 *  • обход на чужую запись (долгое нажатие «Назад» на более раннюю страницу)
 *    — не переносим: у той записи своя история.
 *
 * Как устроено — по образцу SvelteKit (`client.js`: `history_info` в памяти,
 * в `sessionStorage` при уходе вкладки в фон) и React Router (прокрутка в
 * `sessionStorage` по ключу записи):
 *  • ключ записи — `NavigationHistoryEntry.key` Navigation API: он сохраняется
 *    при замене записи (в том числе `replaceState` SvelteKit) и переживает
 *    перезагрузку и восстановление сессии;
 *    https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigationhistoryentry-key
 *  • `history.state` не трогаем: он принадлежит SvelteKit; своё состояние
 *    записи в Navigation API стирается каждым `pushState`/`replaceState`;
 *  • связки записей, которых больше нет в списке истории (новый переход
 *    отрезал «вперёд»), выбрасываются при каждой новой связке и при загрузке.
 */

/** Место хранения между перезагрузками (`sessionStorage`). */
export interface LinksStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Связи слоёв адреса: запоминает, что страница держит в `?modal`/`?page`. */
export interface LayerLinks {
  /** Слой `layer` открыт поверх записи `base`. */
  link(layer: string, base: string): void
  /**
   * Записи из одной стопки: одна лежит под другой (через цепочку слоёв).
   * Порядок аргументов не важен — так покрыты и «назад», и «вперёд».
   */
  sameStack(a: string, b: string): boolean
  /** Оставить связки только записей из `alive` (текущий список истории). */
  prune(alive: Iterable<string>): void
  /** Сохранить в хранилище (уход вкладки в фон). */
  persist(): void
  /** Для тестов и отладки: слой → запись под ним. */
  snapshot(): Readonly<Record<string, string>>
}

/** Ключ `localStorage` для связей слоёв адреса. */
export const LAYER_LINKS_STORAGE_KEY = 'router:layer-links'

/** Стопка слоёв глубже этого — повреждённые данные (цикл), а не интерфейс. */
const MAX_DEPTH = 64

function parse(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {}
  }
}

/** Создаёт реестр связей слоёв поверх хранилища (по умолчанию — `localStorage`). */
export function createLayerLinks(storage?: LinksStorage, key = LAYER_LINKS_STORAGE_KEY): LayerLinks {
  // Хранилище может быть недоступно (приватный режим, запрет cookies): тогда
  // связки живут только в памяти вкладки — до перезагрузки.
  let links: Record<string, string> = {}
  try {
    links = parse(storage?.getItem(key) ?? null)
  } catch {
    links = {}
  }

  /** `upper` лежит над `lower` в цепочке слоёв. */
  const above = (upper: string, lower: string): boolean => {
    let k: string | undefined = links[upper]
    for (let i = 0; k !== undefined && i < MAX_DEPTH; i++) {
      if (k === lower) return true
      k = links[k]
    }
    return false
  }

  return {
    link(layer, base) {
      if (!layer || !base || layer === base) return
      links[layer] = base
    },
    sameStack(a, b) {
      if (!a || !b || a === b) return false
      return above(a, b) || above(b, a)
    },
    prune(alive) {
      const keep = new Set(alive)
      for (const layer of Object.keys(links)) if (!keep.has(layer)) delete links[layer]
    },
    persist() {
      try {
        storage?.setItem(key, JSON.stringify(links))
      } catch {
        // Переполнение или запрет хранилища — связки остаются в памяти.
      }
    },
    snapshot: () => ({ ...links }),
  }
}
