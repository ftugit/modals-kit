<script lang="ts">
  /**
   * Панель настроек хоста модалок — универсальная `DemoPanel` (этап 3).
   *
   * Что осталось странице: зеркало «эффективный `HostConfig` → значения
   * панели» и приёмник параметров (`modals.configure`). Всё остальное —
   * форма, «Применить» до оживления, живая сверка внешнего источника с
   * полями — делает панель: у полей `url: false`, поэтому адрес она не
   * трогает вовсе, а изменения забирает `onParams`.
   *
   * Настройки по-прежнему уходят в СВОЙ per-route слайс (`configure`):
   * демка не течёт на модалки остальных страниц (решение оператора 2026-10-10).
   */
  import { untrack } from 'svelte'
  import type { HostConfig } from '#lib/modals/index.js'
  import { useModals } from '#lib/modals/svelte/index.js'
  import { DemoPanel } from '#lib/components/demo/index.js'
  import { demoPanelSchema, type ModalsDemoValues } from './demo-schema.ts'
  import ModalsDemoFields from './ModalsDemoFields.svelte'

  const m = useModals()

  /** Эффективный конфиг хоста → значения панели (обратное зеркало, не патч). */
  const mirror = (c: Partial<HostConfig>): ModalsDemoValues => ({
    default_mobile: String(c.defaultMobile ?? 'off'),
    floating_mobile: c.floatingMobile === false ? 'off' : 'on',
    open_animation: String(c.openAnimation ?? 'scale'),
    close_animation: String(c.closeAnimation ?? 'scale'),
    stack_animation: String(c.stackAnimation ?? 'cards'),
    tail_direction: String(c.tailDirection ?? 'bottom'),
    max_height: String(c.maxHeight ?? '80vh'),
    clear_on_close: String(c.clearOnClose ?? false),
    tail_count: String(c.tailCount ?? 3),
  })

  /** Живые значения внешнего источника: панель видит их и догоняет формой. */
  const values = $derived(mirror(m.view.hostConfig as Partial<HostConfig>))

  /**
   * Последнее отправленное — снимок, а не форма: патч собирается ДИФФОМ,
   * как при прежней панели. Первый вызов приходит с текущим конфигом и
   * ничего не пишет.
   */
  // svelte-ignore state_referenced_locally
  let last = untrack(() => demoPanelSchema.toParams!(mirror(m.view.hostConfig as Partial<HostConfig>)))

  function apply(params: Record<string, unknown>): void {
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params))
      if (!Object.is(value, last[key])) patch[key] = value
    if (Object.keys(patch).length === 0) return
    last = { ...last, ...params }
    m.modals.configure(patch as Partial<HostConfig>)
  }
</script>

<DemoPanel
  schema={demoPanelSchema}
  {values}
  ui={ModalsDemoFields}
  onParams={apply}
/>
