<script module lang="ts">
  /** Что делать, когда фон заполнился. */
  export type HoldWhen = 'fill' | 'repress'
</script>

<script lang="ts">
  /**
   * Кнопка с подтверждением удержанием: пока держат — фон заливается цветом
   * акцента; отпустили раньше или увели курсор — сброс. Внутри рендерит
   * обычный `Button` (варианты, размеры, `task`, все пропсы потребителя), сам
   * ничего не дублирует: расширения Button подхватывает бесплатно.
   *
   *   <HoldButton form="signup" seconds={5} when="fill">Создать аккаунт</HoldButton>
   *
   *  • `when: 'fill'` — выполнить сразу, как только фон заполнился;
   *    `when: 'repress'` — фон остаётся залитым, следующий клик выполняет.
   *  • Действие: есть `href` — переход (JS-навигация); есть `form` (id) или
   *    кнопка внутри формы — `requestSubmit()` той формы.
   *  • Клавиатура: удержание Space/Enter — то же, что удержание пальца.
   *  • Без JS удержания нет: обычная отправка по клику / обычная ссылка.
   *    (Логика удержания живёт только в JS — требовать его от браузера без
   *    скриптов нельзя.)
   */
  import { goto } from '$app/navigation'
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { TaskState } from '#lib/task/index.js'
  import Button from './Button.svelte'
  import type { ButtonVariants } from './Button.svelte'

  interface Props extends HTMLButtonAttributes, ButtonVariants {
    children?: Snippet
    /** Сколько держать, секунд (по умолчанию 2). */
    seconds?: number
    /** Выполнить сразу после заполнения (`fill`) или по повторному нажатию (`repress`). */
    when?: HoldWhen
    /**
     * Кнопка-ссылка: после удержания переход по адресу. `null` (блокированная
     * ссылка) не поддерживается — удержание нужно действию, а не мёртвой ссылке.
     */
    href?: string
    /** Отправить форму после удержания: id формы; без него — своя (`closest`). */
    form?: string
    /** Задача `#lib/task` — пробрасывается в Button (спиннер, «!», блокировка). */
    task?: TaskState
    ref?: (el: HTMLButtonElement | null) => void
  }

  let {
    children,
    seconds = 2,
    when = 'fill',
    href,
    form,
    task,
    ref,
    class: cls,
    ...rest
  }: Props = $props()

  let self = $state<HTMLButtonElement | null>(null)
  // ref Button — колбэк-проп (не bindable): сам пробрасываю и держу узел себе.
  const grab = (el: HTMLButtonElement | null): void => {
    self = el
    ref?.(el)
  }

  // Прогресс заливки 0..1; `filled` — залито и ждёт повторного нажатия (`repress`).
  let progress = $state(0)
  let filled = $state(false)
  let holding = $state(false)
  let raf = 0
  let startedAt = 0
  const durationMs = $derived(Math.max(100, Math.round(seconds * 1000)))

  const locked = $derived(
    Boolean(rest.disabled || rest['aria-disabled']) || task?.status === 'pending',
  )

  function start(): void {
    if (locked || filled || holding) return
    holding = true
    startedAt = performance.now()
    tick()
  }

  function tick(): void {
    if (!holding) return
    progress = Math.min(1, (performance.now() - startedAt) / durationMs)
    if (progress >= 1) {
      holding = false
      complete()
      return
    }
    raf = requestAnimationFrame(tick)
  }

  function stop(): void {
    if (!holding) return
    holding = false
    cancelAnimationFrame(raf)
    progress = 0
  }

  function complete(): void {
    if (when === 'fill') {
      progress = 0
      perform()
    } else {
      progress = 1
      filled = true
    }
  }

  function perform(): void {
    filled = false
    progress = 0
    if (href !== undefined) {
      void goto(href)
      return
    }
    const target = form ? (document.getElementById(form) as HTMLFormElement | null) : self?.closest('form')
    target?.requestSubmit()
  }

  // Клик — всегда наш: пока скрипты живы, форма не отправляется и ссылка не
  // срабатывает нативно; выполняет только повторное нажатие по залитой (`repress`).
  function onClick(event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    if (filled && when === 'repress') perform()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) start()
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ' || event.key === 'Enter') stop()
  }

  // Долгое нажатие на телефоне открывает контекстное меню — гасим на время удержания.
  function onContextMenu(event: MouseEvent): void {
    if (holding) event.preventDefault()
  }

  const hintId = $props.id()
  const hint = $derived(
    when === 'fill'
      ? `Удерживайте ${seconds} с для подтверждения`
      : `Удерживайте ${seconds} с, затем нажмите ещё раз`,
  )
</script>

<!-- Заливка — абсолютным слоем под текстом; у Button при этом `relative
     overflow-hidden` (добираются через его же `class`). Кнопка остаётся
     настоящей: `type="submit"` внутри формы работает без JS, `<a>` — тоже. -->
<Button
  ref={grab}
  {href}
  {form}
  type={href === undefined ? 'submit' : undefined}
  task={task}
  class="relative overflow-hidden {cls ?? ''}"
  aria-describedby={hintId}
  {...rest}
  onclick={onClick}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  onpointerdown={start}
  onpointerup={stop}
  onpointerleave={stop}
  onpointercancel={stop}
  onblur={stop}
  oncontextmenu={onContextMenu}
>
  <span
    aria-hidden="true"
    class="absolute inset-0 origin-left bg-accent"
    style:transform="scaleX({filled ? 1 : progress})"
  ></span>
  <span class="relative">
    {#if children}{@render children()}{/if}
  </span>
</Button>
<!-- Подсказка для читателя; залитое состояние (`repress`) объявляется живой областью. -->
<span id={hintId} class="sr-only">{hint}</span>
{#if filled}
  <span role="status" class="sr-only">Подтверждено — нажмите ещё раз для выполнения</span>
{/if}
