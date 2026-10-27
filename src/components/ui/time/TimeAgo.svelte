<script lang="ts">
  /**
   * Время в читаемом виде: «5 минут назад» (не старше месяца, дальше —
   * абсолютная дата). Полная дата с временем — в `title` и в `datetime`.
   *
   * Часовой пояс — единый на весь сайт: читается из точки доступа
   * `siteTimeZone` (`time-zone.svelte.ts`); пока пояс там не задан,
   * работает системный. На относительный текст пояс не влияет (длительности
   * считаются по мс), влияет на абсолютную дату старше месяца и на `title`.
   */
  import { onMount } from 'svelte'
  import { cn } from '#components/utils.js'
  import { formatAbsoluteTime, formatTimeAgo } from './time-ago.js'
  import { siteTimeZone } from './time-zone.svelte.js'

  interface Props {
    /** Момент: мс epoch, ISO-строка или Date. */
    value: number | string | Date
    /** Зафиксированное «сейчас» (тесты/SSR-детерминизм); по умолчанию — живые часы. */
    now?: number
    class?: string
  }

  let { value, now: nowProp, class: cls }: Props = $props()

  // Живые часы: относительный текст не должен стареть вместе со страницей.
  let tick = $state(Date.now())
  onMount(() => {
    if (nowProp !== undefined) return
    const id = setInterval(() => (tick = Date.now()), 30_000)
    return () => clearInterval(id)
  })

  const now = $derived(nowProp ?? tick)
  const ms = $derived(value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value)
  const text = $derived(formatTimeAgo(value, { now, timeZone: siteTimeZone.timeZone }))
  const absolute = $derived(formatAbsoluteTime(value, { timeZone: siteTimeZone.timeZone }))
</script>

<time datetime={Number.isFinite(ms) ? new Date(ms).toISOString() : undefined} title={absolute} class={cn('whitespace-nowrap', cls)}>{text}</time>
