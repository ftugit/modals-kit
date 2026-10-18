<script module lang="ts">
  /** Что делать, когда фон заполнился. */
  export type HoldWhen = 'fill' | 'repress'
</script>

<script lang="ts">
  /**
   * Кнопка с подтверждением удержанием: пока держат — фон заливается цветом
   * акцента (`primary`); отпустили раньше или увели курсор — сброс. Внутри
   * рендерит обычный `Button` (варианты, размеры, `task`, все пропсы
   * потребителя), сам ничего не дублирует: расширения Button подхватывает
   * бесплатно.
   *
   *   <HoldButton form="signup" seconds={5} when="fill">Создать аккаунт</HoldButton>
   *
   *  • `when: 'fill'` — выполнить сразу, как только фон заполнился;
   *    `when: 'repress'` — фон остаётся залитым, следующий клик выполняет.
   *  • `hover` — заливка начинается от наведения курсора, без нажатия
   *    (удержание нажатием по-прежнему работает — мобильный курсора не имеет).
   *    На мобильном удержание не превращается в выделение/копирование:
   *    выделение текста и вызов меню на кнопке подавлены.
   *  • До заполнения кнопка заблокирована (`aria-disabled` — вид и семантика
   *    из Button): обычный клик ничего не делает и выглядит неактивным.
   *    `fill` после заполнения разблокируется и сразу выполняет; `repress`
   *    остаётся разблокированной до нажатия.
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
    /** Заливается от наведения курсора (без нажатия); нажатие тоже работает. */
    hover?: boolean
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
    hover = false,
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

  /** Блокировка ДЕЙСТВИЯ потребителя (не удержания): чужой disabled/aria/task. */
  const locked = $derived(
    Boolean(rest.disabled || rest['aria-disabled']) || task?.status === 'pending',
  )
  /** До заполнения кнопка заблокирована: вид и семантика — `aria-disabled`. */
  const blocked = $derived(!filled)

  function start(by: 'pointer' | 'key' | 'hover'): void {
    if (locked || filled || holding) return
    holding = true
    source = by
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
    source = 'none'
    cancelAnimationFrame(raf)
    progress = 0
  }

  function complete(): void {
    holding = false
    source = 'none'
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
    // submitter — обязательно СЕБЯ: Chromium на requestSubmit() без аргумента
    // даёт submitter = null, имя/значение кнопки (намерение формы) не едет.
    // Чужая форма (form=<id>) без своего участия в ней — только no-arg.
    const submitter = self && self.form === target ? self : undefined
    target?.requestSubmit(submitter ?? undefined)
  }

  // Палец/кнопка мыши прижаты — удержание в силе, уход курсора не сбрасывает.
  let pressed = $state(false)
  /** Чем залили: нажатием, клавишей или просто курсором (`hover`). */
  let source: 'none' | 'pointer' | 'key' | 'hover' = $state('none')

  // Клик — всегда наш: пока скрипты живы, форма не отправляется и ссылка не
  // срабатывает нативно; выполняет только повторное нажатие по залитой (`repress`).
  function onClick(event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    if (filled && when === 'repress') perform()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) start('key')
  }

  function onKeyUp(event: KeyboardEvent): void {
    if ((event.key === ' ' || event.key === 'Enter') && source === 'key') stop()
  }

  // Долгое нажатие на телефоне открывает контекстное меню и выделение — гасим.
  function onContextMenu(event: MouseEvent): void {
    if (holding || progress > 0) event.preventDefault()
  }

  function onPointerDown(event: PointerEvent): void {
    pressed = true
    // отпускание за границами кнопки всё равно придёт сюда (иначе заливка
    // продолжалась бы с курсором, ушедшим на другой элемент)
    try {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    } catch {
      /* старые среды без capture — отпускание мимо границ просто сбросит */
    }
    start('pointer')
  }
  function onPointerUp(): void {
    pressed = false
    // курсорная заливка (`hover`) нажатием не прерывается
    if (source === 'pointer') stop()
  }
  function onPointerLeave(): void {
    if (source !== 'pointer') stop()
  }

  const hintId = $props.id()
  const hint = $derived(
    when === 'fill'
      ? `Удерживайте ${seconds} с для подтверждения`
      : `Удерживайте ${seconds} с, затем нажмите ещё раз`,
  )
</script>

<!-- Заливка — абсолютным слоем под текстом; у Button при этом `relative
     overflow-hidden` (добираются через его же `class`). Цвет заливки —
     акцент палитры (`primary`): на светлых вариантах кнопки заливка видна,
     у тёмной default слилась бы с фоном. `select-none` и запрет callout —
     чтобы удержание на мобильном не превращалось в выделение/копирование.
     Кнопка остаётся настоящей: `type="submit"` внутри формы работает без JS. -->
<Button
  ref={grab}
  {href}
  {form}
  type={href === undefined ? 'submit' : undefined}
  task={task}
  class="relative overflow-hidden select-none touch-manipulation [-webkit-touch-callout:none] {cls ?? ''}"
  aria-describedby={hintId}
  aria-disabled={blocked || undefined}
  {...rest}
  onclick={onClick}
  onkeydown={onKeyDown}
  onkeyup={onKeyUp}
  onpointerdown={onPointerDown}
  onpointerup={onPointerUp}
  onpointerenter={hover ? () => start('hover') : undefined}
  onpointerleave={onPointerLeave}
  onpointercancel={onPointerUp}
  onblur={() => {
    if (source !== 'pointer') stop()
  }}
  oncontextmenu={onContextMenu}
>
  <span
    aria-hidden="true"
    class="absolute inset-0 origin-left bg-primary"
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
