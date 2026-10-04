<script lang="ts">
  // Порт LoadLink из fastedge/router.tsx оригинала (слой фреймворка):
  // <a href>, который при клике сначала прогоняет загрузчики адреса и лишь
  // потом переходит — данные уже в кэше, страница появляется без
  // промежуточного ожидания. Статус загрузки берём у ФРЕЙМВОРКА
  // ($app/navigation preloadData/goto), как в оригинале у его роутера.
  //
  // «Битая ссылка» блокируется ДО клика — data-state=error, aria-disabled,
  // клик погашен, уже в SSR-разметке. Проверку делает routeResolves из
  // слоя фреймворка ядра (та же таблица роутов, что и у триггера route-модалок):
  // ссылка только рисует состояние, сама она ничего не проверяет
  // (осмотр 1.10-2, №30/№31).
  import { goto, preloadData } from '$app/navigation'
  import { routeResolves } from '$lib/modals/cores/sveltekit'
  import { ButtonIndicator } from '$lib/ui/modals'

  interface Props {
    href: string
    class?: string
    /** Заменить запись истории вместо добавления. */
    replace?: boolean
    /**
     * При ошибке загрузчика всё равно переходить (по умолчанию — да:
     * страницу покажет её +error). Как `navigateOnError` оригинала.
     */
    navigateOnError?: boolean
    title?: string
    children?: import('svelte').Snippet
  }
  let {
    href,
    class: cls,
    replace = false,
    navigateOnError = true,
    title: titleProp,
    children,
  }: Props = $props()

  type State = 'idle' | 'loading' | 'error'
  // `status`, а не `state`: имя `state` затенило бы руну `$state`.
  let status = $state<State>('idle')
  let innerError = $state<string | null>(null)
  // До гидрации клиентский код ещё не ожил: ссылка при этом обычная,
  // без JS переход на страницу.
  let pending = $state(true)
  $effect(() => {
    pending = false
  })

  /** Адреса нет в таблице роутов — блокируем, как незарегистрированную модалку. */
  const broken = $derived(!routeResolves(href))
  const visualState = $derived<State>(broken ? 'error' : status)
  const title = $derived(
    broken
      ? `Страницы ${href.split(/[?#]/, 1)[0]} не существует`
      : (innerError ?? titleProp),
  )

  /** Модификаторы и средняя кнопка — отдаём браузеру, как обычной ссылке. */
  const isModified = (e: MouseEvent) =>
    e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0

  async function onclick(event: MouseEvent) {
    if (isModified(event)) return
    event.preventDefault()
    if (broken || status === 'loading') return

    status = 'loading'
    innerError = null
    const r = await preloadData(href)
    if (r.type !== 'loaded') {
      innerError = r.type === 'redirect' ? `переход: ${r.location}` : 'не удалось загрузить страницу'
      status = 'error'
      if (!navigateOnError) return
    } else {
      status = 'idle'
    }
    // replaceState — так называется опция у goto SvelteKit (у navigate
    // оригинала была replace)
    goto(href, { replaceState: replace })
  }
</script>

<!-- Разметка — порт LoadLink оригинала: класс modal-trigger, индикатор
     состояния и span вокруг содержимого (как у триггера модалок). -->
<a
  {href}
  class={cls}
  {title}
  data-state={visualState}
  data-pending={pending || undefined}
  aria-busy={visualState === 'loading' || undefined}
  aria-disabled={broken || undefined}
  {onclick}
>
  <ButtonIndicator state={visualState} />
  <span>{#if children}{@render children()}{/if}</span>
</a>
