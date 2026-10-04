// Контракт ЯДРА: единственное, с чем разговаривает модалка.
//
//     модалка(ядро(хранилище), опции)
//
// Модалка не знает ни движка, ни хранилища — только ядро. Ядро владеет
// хранилищем и само решает, что и куда класть.
//
// Идиомы взяты у lib/paginate (PaginatorAdapter) — тот же проект, тот же стиль:
//   • переговоры о возможностях ПО НАЛИЧИЮ МЕТОДА, а не по типу адаптера;
//     `const hasHistory = typeof adapter.back === 'function'` — хост нигде
//     не спрашивает «ты какой адаптер?»;
//   • то, что нельзя выразить наличием метода, — в явном `capabilities`;
//   • разбор формата принадлежит транспорту, а не хосту: адрес умеет читать
//     только адресный адаптер;
//   • `bind()` есть лишь у транспортов, которым нужен роутер фреймворка.
//
// Файл НЕ импортирует ничего: ни фреймворк, ни DOM, ни core. Это цель.

// Модель записи живёт в types.ts — здесь только транспорт.
// (Раньше она дублировалась ради «0 импортов»; svelte-check это поймал.)
export type {
  Chain,
  ChainEntry,
  ChainOverrides,
  RegisteredEntry,
  TransientEntry,
} from './types'
import type { Chain, ChainEntry } from './types'

/* ── контексты (чтобы lib не тянула server-only модули) ────────────── */

/** SSR: адрес запроса приходит снаружи, адаптер не лезет в window. */
export interface ReadContext {
  url?: string
}

export interface HrefContext {
  url?: string
}

export interface WriteOptions {
  /** Заменить текущую запись истории вместо добавления новой. */
  replace?: boolean
}

/* ── возможности транспорта ────────────────────────────────────────── */

/**
 * То, что нельзя выразить наличием метода. Хост читает это, чтобы решить,
 * что вообще предлагать: нет `addressable` — незачем строить href;
 * нет `transient` — `openLayer()` должен честно упасть, а не открыть слой,
 * который потеряется при первом же Назад.
 */
export interface CoreCapabilities {
  /** Записи сериализуются в адрес: переживают F5 и передаются ссылкой. */
  addressable: boolean
  /** Записи без адреса, но со своей записью истории. */
  transient: boolean
  /** Есть история браузера: закрытие — шаг назад, «Вперёд» возвращает. */
  history: boolean
}

/* ── сам контракт ──────────────────────────────────────────────────── */

/** Итог предзагрузки данными фреймворка. */
export type PreloadResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: 'not-found' | 'redirect' | 'error'; status?: number }

export interface ModalCore {
  /** Человеко-читаемое имя транспорта — только для сообщений об ошибках. */
  readonly name: string

  readonly capabilities: CoreCapabilities

  /**
   * Разрешение имён, с которым собрано ядро. Модалке оно нужно для `lock`,
   * `noForward` и событий жизненного цикла; требовать его вторым аргументом
   * значило бы заставлять потребителя передавать одно и то же дважды.
   */
  readonly lookup?: (name: string) => unknown

  /** Как читается стопка. Синхронно: хост рисует в том же кадре. */
  read(ctx?: ReadContext): Chain

  /** Как хранится стопка. */
  write(chain: Chain, options?: WriteOptions): void

  /**
   * Внешние изменения: Назад/Вперёд, другая вкладка, правка адреса руками.
   * Метода нет → у транспорта нет наблюдаемого внешнего мира, и хост
   * не пытается его слушать (память, SSR).
   */
  subscribe?(listener: (chain: Chain) => void): () => void

  /**
   * Шаг назад по истории вместо новой записи — чтобы закрытие не затирало
   * «Вперёд». Метода нет → хост делает `write(chain, { replace: true })`.
   */
  back?(steps: number, chain: Chain): void

  /**
   * Адрес стопки для `<a href>`: без JS пользователь попадает на страницу.
   * Метода нет или вернул null → адресной семантики у транспорта нет,
   * триггер отрисует обычную кнопку.
   */
  hrefFor?(chain: Chain, ctx?: HrefContext): string | null

  /**
   * Существует ли такой маршрут. Нужно триггеру, чтобы заблокировать битый
   * `route` ДО клика. Метода нет → не проверяем (клик даст 404).
   */
  resolves?(href: string): boolean

  /**
   * Данные маршрута силами фреймворка.
   *
   * Зачем: у модалки с `route` данные сегодня добываются ДВАЖДЫ — загрузчиком
   * страницы (для работы без JS) и `definition.loader` (для модалки). Это
   * буквально задокументировано в демо оригинала: «В модалке те же данные
   * приходят через loader». Если транспорт умеет исполнить загрузчик самого
   * маршрута (в SvelteKit — `preloadData`), дублирование исчезает:
   * у модалки с `route` свой `loader` становится не нужен.
   *
   * Метода нет → хост грузит только через `definition.loader`, как раньше.
   */
  preload?(href: string): Promise<PreloadResult>

  /**
   * Привязка к роутеру фреймворка. Есть только у транспортов, которым он
   * нужен: хост зовёт `bind()` на монтировании и функцию-развязку на размонтировании.
   */
  bind?(): () => void
}

/* ── хелперы переговоров (чтобы хост не писал typeof по месту) ─────── */

/** Транспорт умеет отдать данные маршрута — значит свой loader не обязателен. */
export const canPreload = (a: ModalCore): boolean => typeof a.preload === 'function'
/** Умеет ли транспорт сформировать адрес стопки для ссылки без JavaScript. */
export const canLink = (a: ModalCore): boolean =>
  a.capabilities.addressable && typeof a.hrefFor === 'function'

/** Транспорт не умеет transient — открывать такой слой нельзя, и молчать об этом нельзя. */
export function assertTransient(a: ModalCore): void {
  if (!a.capabilities.transient) {
    throw new Error(
      `[modals] Ядро «${a.name}» не поддерживает transient-слои. ` +
        'Зарегистрируйте модалку через registerModal() и откройте по имени, ' +
        'либо подключите адаптер с capabilities.transient.',
    )
  }
}

/** Единственное место, где закреплено правило «transient только на вершине». */
export function assertTransientOnTop(chain: Chain): void {
  const firstTransient = chain.findIndex((e) => e.kind === 'transient')
  if (firstTransient === -1) return
  const tail = chain.slice(firstTransient)
  if (!tail.every((e) => e.kind === 'transient')) {
    throw new Error(
      '[modals] transient-запись оказалась ниже registered. Адрес кодирует параметры ' +
        'позиционно (modal.0.*, modal.1.*), поэтому несериализуемая запись в середине ' +
        'сдвинула бы индексы всех записей правее.',
    )
  }
}
