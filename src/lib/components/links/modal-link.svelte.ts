// `asModalLink` — сделать элемент ссылкой, открывающей модалку. Вид даёт сам
// элемент, обычно `Button`:
//
//   <script>
//     const asModalLink = useModalLink()   // область ModalHost — из контекста
//   </script>
//   <Button {...asModalLink('card', { id: 7 })} variant="outline">Карточка</Button>
//
// Что делает:
//  - `href`: `route` модалки, иначе адрес с `?modal=…`. Модалка с `route` и
//    без JS — рабочая ссылка на свою страницу. Без `route` модалку открыть
//    можно только с JS: до гидрации ссылка заблокирована (`data-pending`);
//  - не объявлена или её `route` ведёт в никуда — заблокирована всегда, «!» и
//    причина в `title`; на 404 пользователь не попадает;
//  - прогоняет загрузчик ДО открытия: модалка появляется уже с данными, а на
//    ссылке через 150 мс виден спиннер; ошибка загрузчика — «!» на ссылке;
//  - пока её модалка открыта, повторный клик гасится (`aria-disabled`).
//
// Лежит рядом с `asLink`: это UI над модалками и фреймворком, а не часть
// библиотеки модалок — механику стопки даёт публичный `#lib/modals`.
import { createAttachmentKey } from 'svelte/attachments'
import { chainToSearch, nextChain, routeHref } from '#lib/modals/index.js'
import type { ChainOverrides, ChainEntry, RegisteredEntry, StackMode } from '#lib/modals/index.js'
import { useModals } from '#lib/modals/svelte/index.js'
import { useJsOnly } from '#lib/hooks/js-only.svelte.js'
import { blockClicks, defined, isModified, reflectTask, type LinkAttrs } from './state.svelte.js'

export interface ModalLinkOptions extends ChainOverrides {
  /** Готовый адрес для перехода без JS. По умолчанию: `route`, иначе адрес с `?modal=…`. */
  href?: string
  /**
   * Что сделать с текущей стопкой при открытии (решение владельца 30.09,
   * журнал §6 №9):
   *  - `'new'` — «с новой стопкой»: стоишь в `a,b,c`, открываешь `d` — и
   *    клик, и ссылка ведут на `?modal=d`;
   *  - `'first'` — «в начало стопки»: `a,b,c` + `d` → `?modal=a,d`.
   * Без опции запись дополняет стопку (`?modal=a,b,c,d`). Опция перестраивает
   * и `href`: без JS ссылка ведёт ровно туда, куда приводит клик с JS.
   */
  stack?: StackMode
  /** Вызывается после успешного открытия записи. */
  onOpened?: () => void
}

type ModalLinkStatus = 'idle' | 'loading' | 'open' | 'error'
type OwnState = { status: ModalLinkStatus; openedAt: number | null }

/** То, что знала последняя версия атрибутов: клик дочитывает их после `await`. */
interface Latest {
  name: string
  params: Record<string, unknown>
  stack: StackMode | undefined
  overrides: ChainOverrides
  wouldOpen: ChainEntry[]
  hasLoader: boolean
  onOpened: (() => void) | undefined
}

const MODAL_LINK = createAttachmentKey()

// Атрибуты пересчитываются при каждой смене стопки (вместе с ними и
// вложение), а элемент тот же: его состояние и ожидание загрузки живут на нём.
const own = new WeakMap<Element, OwnState>()
const latest = new WeakMap<Element, Latest>()
const loading = new WeakMap<Element, AbortController>()
const ownOf = (el: Element): OwnState => {
  const found = own.get(el)
  if (found) return found
  const st: OwnState = $state({ status: 'idle', openedAt: null })
  own.set(el, st)
  return st
}

/**
 * Вызывать в `<script>` компонента: берёт из контекста область ModalHost.
 * Возвращает `asModalLink(name, params?, options?)` для разметки.
 */
export function useModalLink() {
  const m = useModals()
  const jsOnly = useJsOnly()

  return function asModalLink(
    name: string,
    params: Record<string, unknown> = {},
    options: ModalLinkOptions = {},
  ): LinkAttrs {
    const { href: hrefOption, stack, onOpened, ...rest } = options
    const overrides = defined({ ...rest }) as ChainOverrides

    const definition = m.scope.resolve(name)?.definition
    const routeTarget = routeHref(definition?.route, params)
    // У SvelteKit `resolves` у ядра есть (таблица роутов, решение №30); у
    // ядра без неё проверяется только объявление.
    const routeBroken = routeTarget !== null && m.modals.core.resolves ? !m.modals.core.resolves(routeTarget) : false

    if (!definition || routeBroken) {
      return {
        ...defined({
          role: 'link',
          title: routeBroken
            ? `Модалка «${name}»: страницы ${routeTarget} не существует`
            : `Модалка «${name}» не объявлена в этой области`,
          'aria-disabled': 'true',
          'aria-haspopup': 'dialog',
          'data-state': 'error',
          'data-modal-link': '',
        }),
        href: null,
        [MODAL_LINK]: blockClicks,
      }
    }

    const entry = { kind: 'registered', name, params, overrides } as RegisteredEntry
    const wouldOpen = nextChain(m.view.chain, entry, stack)
    // До гидрации клиентский код ещё не ожил: модалку без `route` не открыть,
    // а адрес с `?modal=…` сервер не покажет — такая ссылка заблокирована.
    const pending = jsOnly()
    let href: string | null = hrefOption ?? routeTarget
    if (href === null && !pending) {
      const only = wouldOpen.filter((e): e is RegisteredEntry => e.kind === 'registered')
      // Видимый адрес — у ядра (реактивный: href обновляется после
      // клиентской навигации, F37); без метода — адресная строка как есть.
      const loc =
        m.modals.core.location?.() ?? (typeof location !== 'undefined' ? location : { pathname: '/', search: '' })
      href = loc.pathname + chainToSearch(only, m.scope.lookup, new URLSearchParams(loc.search))
    }

    const current: Latest = {
      name,
      params,
      stack,
      overrides,
      wouldOpen,
      hasLoader: Boolean(definition.loader || definition.route),
      onOpened,
    }

    return {
      ...defined({
        role: href === null ? 'link' : undefined,
        'aria-disabled': href === null ? 'true' : undefined,
        'aria-haspopup': 'dialog',
        'data-modal-link': '',
        'data-pending': pending ? '' : undefined,
      }),
      href,
      [MODAL_LINK]: (el: HTMLElement) => {
        latest.set(el, current)
        const st = ownOf(el)
        const onClick = (e: MouseEvent) => {
          if (isModified(e)) return
          e.preventDefault()
          if (st.status === 'idle') void open(el, st)
        }
        el.addEventListener('click', onClick)

        // Модалку, которую открыла эта ссылка, закрыли — ссылка снова доступна.
        $effect(() => {
          const len = m.view.chain.length
          if (st.openedAt !== null && len <= st.openedAt) {
            st.openedAt = null
            if (st.status === 'open') st.status = 'idle'
          }
        })

        reflectTask(
          el,
          () =>
            st.status === 'error'
              ? { status: 'error', message: `Модалка «${name}»: не удалось загрузить данные` }
              : st.status === 'loading'
                ? { status: 'pending', scope: 'local', label: 'Загрузка модалки' }
                : { status: 'idle' },
          { idleState: () => (st.status === 'open' ? 'open' : undefined), busy: () => st.status !== 'idle' },
        )

        return () => {
          el.removeEventListener('click', onClick)
          // Вложение пересоздаётся и при живом элементе (сменилась стопка).
          // Ожидание загрузки принадлежит элементу: ушёл со страницы —
          // загрузка отменена и модалка НЕ откроется (F29).
          queueMicrotask(() => {
            if (!el.isConnected) loading.get(el)?.abort()
          })
        }
      },
    }
  }

  async function open(el: Element, st: OwnState): Promise<void> {
    let now = latest.get(el)!
    if (now.hasLoader) {
      // Загрузчик работает ДО открытия: модалка откроется уже с данными.
      st.status = 'loading'
      const owner = new AbortController()
      loading.set(el, owner)
      const r = await m.loader.preloadModal(now.name, now.params, { signal: owner.signal })
      if (owner.signal.aborted) return
      loading.delete(el)
      if (!r.ok) {
        st.status = 'error'
        return
      }
      now = latest.get(el)!
    }
    // «Моя модалка ещё открыта» сбрасывается, когда длина цепочки упала до
    // индекса нашей записи (для 'new' это 0, для 'first' — 1, иначе —
    // прежняя длина стопки). href и клик считаются одной `nextChain` (§6 №9).
    st.openedAt = now.wouldOpen.length - 1
    m.modals.open(now.name, { params: now.params, stack: now.stack, ...now.overrides })
    st.status = 'open'
    now.onOpened?.()
  }
}
