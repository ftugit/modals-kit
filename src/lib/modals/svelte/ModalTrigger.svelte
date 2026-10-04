<script lang="ts">
  // Кнопка-триггер: настоящий <a href>, чтобы без JS пользователь попадал
  // на страницу. Порт `use-trigger.ts` + `ui/modals/trigger.tsx`.
  //
  // Что делает сама:
  //   • строит href — `route` модалки, иначе адрес с ?modal=…
  //   • ПРОГОНЯЕТ ЗАГРУЗЧИК ДО ОТКРЫТИЯ: модалка появляется уже с данными,
  //     а на кнопке виден индикатор
  //   • состояние idle/loading/open/error
  //   • модификаторы и среднюю кнопку отдаёт браузеру, как обычная ссылка
  //   • блокируется для незарегистрированного имени
  import { chainToSearch, nextChain, routeHref } from '../core'
  import type { ChainOverrides, RegisteredEntry, StackMode } from '../types'
  import { ButtonIndicator } from '$lib/ui/modals'
  import { useModals } from './context'

  /** Публичные props триггера зарегистрированной модалки. */
  interface Props extends ChainOverrides {
    /** Имя модалки в области ModalHost. */
    name: string
    /** Параметры новой записи. */
    params?: Record<string, unknown>
    /** Готовый href. По умолчанию: `route`, иначе адрес с ?modal=… */
    href?: string
    /**
     * Что сделать с текущей стопкой при открытии (решение владельца
     * 30.09, журнал §6 №9 — вместо неудачного `fromRoot` оригинала):
     *
     *  - `'new'` — «с новой стопкой»: стоишь в `a,b,c`, жмёшь триггер
     *    модалки `d` — и клик, и ссылка ведут на `?modal=d`. Способ
     *    выбраться из глубокой стопки в новое одиночное состояние
     *    (поведение href прежнего `fromRoot`);
     *  - `'first'` — «в начало стопки»: стопка закрывается до самой
     *    первой модалки, новая открывается поверх неё: `a,b,c` + `d`
     *    → `?modal=a,d`.
     *
     * Без опции запись дополняет текущую стопку (`?modal=a,b,c,d`).
     *
     * Опция перестраивает и href: путь без JS ведёт ровно туда же,
     * куда приводит клик с JS. У `route`-модалок опция не видна:
     * route — полноэкранная страница, стопки там нет.
     */
    stack?: StackMode
    /** CSS-класс интерактивного элемента триггера. */
    class?: string
    /** Всплывающая подсказка интерактивного элемента. */
    title?: string
    /** Текст или Svelte-содержимое интерактивного элемента. */
    children?: import('svelte').Snippet
    /** Вызывается после успешного открытия записи. */
    onOpened?: () => void
  }
  let {
    name, params, href: hrefProp, stack, class: cls, title: titleProp,
    children, onOpened, ...overrides
  }: Props = $props()

  const m = useModals()


  type State = 'idle' | 'loading' | 'open' | 'error'
  // `status`, а не `state`: имя `state` затенило бы руну `$state`.
  let status = $state<State>('idle')
  // До гидратации клиентский код ещё не ожил — UI может показать это.
  let pending = $state(true)
  $effect(() => {
    pending = false
  })

  const definition = $derived(m.scope.resolve(name)?.definition)
  const routeTarget = $derived(routeHref(definition?.route, params ?? {}))

  // «Известна» = объявлена И её route (если задан) ведёт на существующую
  // страницу. У SvelteKit проверка маршрута — на уровне типов, поэтому
  // `resolves` у ядра обычно нет; тогда проверяем только объявление.
  const routeBroken = $derived(
    routeTarget !== null && m.modals.core.resolves ? !m.modals.core.resolves(routeTarget) : false,
  )
  const known = $derived(Boolean(definition) && !routeBroken)
  const hasLoader = $derived(Boolean(definition?.loader || definition?.route))

  const clean = $derived.by(() => {
    const o: ChainOverrides = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) (o as Record<string, unknown>)[k] = v
    }
    return o
  })

  /** Запись, которую открыл бы этот триггер, и цепочка после открытия. */
  const wouldOpen = $derived.by(() => {
    const entry = {
      kind: 'registered',
      name,
      params: params ?? {},
      overrides: clean,
    } as RegisteredEntry
    return nextChain(m.view.chain, entry, stack)
  })

  /** href нужен ровно для одного: без JS пользователь попадает на страницу. */
  const href = $derived.by(() => {
    if (hrefProp) return hrefProp
    if (routeTarget) return routeTarget
    const only = wouldOpen.filter((e): e is RegisteredEntry => e.kind === 'registered')
    const loc = typeof location !== 'undefined' ? location : { pathname: '/', search: '' }
    return loc.pathname + chainToSearch(only, m.scope.lookup, new URLSearchParams(loc.search))
  })

  // Модалку, которую открыла эта кнопка, закрыли — кнопка снова доступна.
  let openedAt = $state<number | null>(null)
  $effect(() => {
    const len = m.view.chain.length
    if (openedAt === null) return
    if (len <= openedAt) {
      openedAt = null
      status = status === 'error' ? 'error' : 'idle'
    }
  })

  const visualState = $derived<State>(known ? status : 'error')
  const disabled = $derived(visualState !== 'idle')
  const title = $derived(
    known
      ? titleProp
      : routeBroken
        ? `Модалка «${name}»: страницы ${routeTarget} не существует`
        : `Модалка «${name}» не объявлена в этой области`,
  )

  /** Модификаторы и средняя кнопка — отдаём браузеру, как обычной ссылке. */
  const isModified = (e: MouseEvent) =>
    e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

  async function handleClick(event: MouseEvent) {
    if (isModified(event)) return
    event.preventDefault()
    if (!known || status !== 'idle') return

    if (hasLoader) {
      // Загрузчик работает ДО открытия: модалка откроется уже с данными.
      status = 'loading'
      const r = await m.loader.preloadModal(name, params ?? {})
      if (!r.ok) {
        status = 'error'
        return
      }
    }

    // Учёт «моя модалка ещё открыта»: сбрасывается, когда длина цепочки
    // упала до индекса нашей записи (для 'new' это 0, для 'first' — 1,
    // для обычного открытия — прежняя длина стопки).
    openedAt = wouldOpen.length - 1
    // Режим стопки передаётся в open() — по решению владельца (§6 №9).
    // У прежнего `fromRoot` оригинала здесь было расхождение: href вёл
    // на «только эта модалка», а клик с JS молча дополнял стопку (№8).
    // Теперь оба пути считаются одной функцией `nextChain`.
    m.modals.open(name, { params, stack, ...clean })
    status = 'open'
    onOpened?.()
  }
</script>

<!-- Разметочная половина — порт ui/modals/trigger.tsx оригинала: класс
     modal-trigger, индикатор состояния и span вокруг содержимого. Индикатор
     берется из ui-слоя порта ($lib/ui/modals) — в оригинале обе половины
     триггера жили в разных слоях, здесь логика в этом же файле. -->
<a
  {href}
  class={`modal-trigger ${cls ?? ''}`}
  {title}
  aria-haspopup="dialog"
  aria-disabled={disabled || undefined}
  data-state={visualState}
  data-pending={pending || undefined}
  onclick={handleClick}
>
  <ButtonIndicator state={visualState} />
  <span>{#if children}{@render children()}{/if}</span>
</a>
