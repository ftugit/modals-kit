<script lang="ts">
  /**
   * Панель настроек хоста модалок (демо): поля самого механизма `bind`
   * (зеркало читает разметка, эффект шлёт в стор только ДИФФ). Пишет через
   * `modals.configure` — в СВОЙ per-route слайс, настройки демки не течёт
   * на модалки остальных страниц (решение оператора 2026-10-10).
   */
  import type { MobileAnchor } from '$lib/modals'
  import { useModals } from '$lib/modals/svelte'
  import { bind, createConfig } from '$lib/form/svelte'
  import { defineForm, field } from '$lib/form'
  import { untrack } from 'svelte'
  import { Input } from '$lib/ui/primitives'
  import { Field as PanelField, Select as PanelSelect } from '$lib/ui/settings'

  const m = useModals()

  // Настройки хоста: страница только ПОСЫЛАЕТ патчи, состояние — в сторе.
  // Этап 8: панель — поля самого механизма (`bind` без url, зеркало читает
  // разметка, эффект шлёт в стор только ДИФФ). Дефолты зеркала — снимок
  // `hostConfig` на инициализации: ничего не «улучшаем», только отражаем.
  const cfg0 = untrack(() => m.view.hostConfig)
  const PANEL_DEFAULTS: Record<string, string> = {
    default_mobile: cfg0.defaultMobile ?? 'off',
    floating_mobile: cfg0.floatingMobile === false ? 'off' : 'on',
    open_animation: String(cfg0.openAnimation ?? 'scale'),
    close_animation: String(cfg0.closeAnimation ?? 'scale'),
    stack_animation: String(cfg0.stackAnimation ?? 'cards'),
    tail_direction: String(cfg0.tailDirection ?? 'bottom'),
    max_height: String(cfg0.maxHeight ?? '80vh'),
    clear_on_close: String(cfg0.clearOnClose ?? false),
    tail_count: String(cfg0.tailCount ?? 3),
  }
  const panelCfg = createConfig({
    resolve: () => undefined,
    ui: { fieldId: (_formId, name) => name },
  })
  const settings = bind(panelCfg, defineForm({
    id: 'modal-settings',
    fields: {
      default_mobile: field.select({
        label: 'Мобильный режим (умолчание)',
        defaultValue: PANEL_DEFAULTS.default_mobile,
        options: [
          { value: 'off', label: 'выкл' },
          { value: 'bottom', label: 'низ' },
          { value: 'top', label: 'верх' },
          { value: 'left', label: 'лево' },
          { value: 'right', label: 'право' },
        ],
      }),
      floating_mobile: field.select({
        label: 'Мобильный режим popup-меню (умолчание)',
        defaultValue: PANEL_DEFAULTS.floating_mobile,
        options: [
          { value: 'on', label: 'как у модалок' },
          { value: 'off', label: 'выпадашка' },
        ],
      }),
      open_animation: field.select({
        label: 'Анимация открытия',
        defaultValue: PANEL_DEFAULTS.open_animation,
        options: [
          { value: 'scale', label: 'scale' },
          { value: 'fade', label: 'fade' },
          { value: 'slide-up', label: 'slide' },
          { value: 'none', label: 'выкл' },
        ],
      }),
      close_animation: field.select({
        label: 'Анимация закрытия',
        defaultValue: PANEL_DEFAULTS.close_animation,
        options: [
          { value: 'scale', label: 'scale' },
          { value: 'fade', label: 'fade' },
          { value: 'slide-down', label: 'slide' },
          { value: 'none', label: 'выкл' },
        ],
      }),
      stack_animation: field.select({
        label: 'Анимация стопки',
        defaultValue: PANEL_DEFAULTS.stack_animation,
        options: [
          { value: 'cards', label: 'карты' },
          { value: 'deck', label: 'колода' },
          { value: 'fan', label: 'веер' },
          { value: 'none', label: 'выкл' },
        ],
      }),
      tail_direction: field.select({
        label: 'Направление хвостов',
        defaultValue: PANEL_DEFAULTS.tail_direction,
        options: [
          { value: 'bottom', label: 'вниз' },
          { value: 'top', label: 'вверх' },
          { value: 'left', label: 'влево' },
          { value: 'right', label: 'вправо' },
          { value: 'none', label: 'выкл' },
        ],
      }),
      max_height: field.select({
        label: 'Макс. высота модалки',
        defaultValue: PANEL_DEFAULTS.max_height,
        options: [
          { value: '60vh', label: '60vh' },
          { value: '70vh', label: '70vh' },
          { value: '80vh', label: '80vh' },
          { value: '90vh', label: '90vh' },
        ],
      }),
      clear_on_close: field.select({
        label: 'Очистка памяти после закрытия',
        defaultValue: PANEL_DEFAULTS.clear_on_close,
        options: [
          { value: 'false', label: 'хранить' },
          { value: 'true', label: 'очищать' },
        ],
      }),
      tail_count: field.text({
        label: 'Число хвостов',
        defaultValue: PANEL_DEFAULTS.tail_count,
      }),
    },
  }), {})
  const sv = (name: string) => String(settings.values[name] ?? PANEL_DEFAULTS[name] ?? '')

  // Ключи стора: имя поля -> имя в hostConfig; тумблеры панелевидных полей.
  const CFG_KEYS: Record<string, string> = {
    default_mobile: 'defaultMobile', floating_mobile: 'floatingMobile',
    open_animation: 'openAnimation', close_animation: 'closeAnimation',
    stack_animation: 'stackAnimation', tail_direction: 'tailDirection',
    max_height: 'maxHeight', clear_on_close: 'clearOnClose', tail_count: 'tailCount',
  }
  const target = () => ({
    defaultMobile: sv('default_mobile') as MobileAnchor | 'off',
    floatingMobile: sv('floating_mobile') === 'on',
    openAnimation: sv('open_animation'),
    closeAnimation: sv('close_animation'),
    stackAnimation: sv('stack_animation'),
    tailDirection: sv('tail_direction') as 'bottom' | 'top' | 'left' | 'right' | 'none',
    maxHeight: sv('max_height') as `${number}vh`,
    clearOnClose: sv('clear_on_close') === 'true',
    tailCount: Number(sv('tail_count')),
  })
  let lastCfg = untrack(() => ({ ...target() }))
  $effect(() => {
    const next = target()
    const patch: Record<string, unknown> = {}
    for (const key of Object.keys(next) as (keyof ReturnType<typeof target>)[])
      if (next[key] !== lastCfg[key]) patch[key] = next[key]
    if (Object.keys(patch).length > 0) {
      lastCfg = { ...lastCfg, ...next }
      m.modals.configure(patch)
    }
  })

  // Обратная сверка, как `hydrate` у пагинаторной панели: эффективный
  // hostConfig (дефолты ядра, изменения из other-источников) становится
  // значением зеркала, если они разошлись. Без цикла: обе стороны пишут
  // только при различии. Снимок на инициализации для SSR остаётся фолбэком.
  const cfgToMirror = (c: typeof lastCfg): Record<string, string> => ({
    default_mobile: String((c as { defaultMobile?: string }).defaultMobile ?? 'off'),
    floating_mobile: (c as { floatingMobile?: boolean }).floatingMobile === false ? 'off' : 'on',
    open_animation: String((c as { openAnimation?: string }).openAnimation ?? 'scale'),
    close_animation: String((c as { closeAnimation?: string }).closeAnimation ?? 'scale'),
    stack_animation: String((c as { stackAnimation?: string }).stackAnimation ?? 'cards'),
    tail_direction: String((c as { tailDirection?: string }).tailDirection ?? 'bottom'),
    max_height: String((c as { maxHeight?: string }).maxHeight ?? '80vh'),
    clear_on_close: String((c as { clearOnClose?: boolean }).clearOnClose ?? false),
    tail_count: String((c as { tailCount?: number }).tailCount ?? 3),
  })
  $effect(() => {
    const c = m.view.hostConfig as typeof lastCfg
    const want = cfgToMirror(c)
    for (const name of Object.keys(want)) {
      if (sv(name) !== want[name]) settings.field(name)?.onInput(want[name])
    }
  })

  const SETTINGS = ['default_mobile', 'floating_mobile', 'open_animation', 'close_animation',
                    'stack_animation', 'tail_direction', 'max_height', 'clear_on_close'] as const
</script>
    <section class="grid gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:grid-cols-2">
        {#each SETTINGS as name (name)}
          {@const v = settings.field(name)!}
          <PanelField label={v.label ?? name}>
            <PanelSelect
              value={sv(name)}
              options={(v.options ?? []).map((o) => [o.value, o.label] as const)}
              onChange={(x) => v.onInput(x)}
              {...v.attrs}
            />
          </PanelField>
        {/each}
        {#each ['tail_count'] as name (name)}
          {@const v = settings.field(name)!}
          <PanelField label={`${v.label ?? name}: ${Number(sv(name))}`}>
            <Input
              {...v.attrs}
              type="range"
              min="0"
              max="6"
              class="w-full accent-primary"
              value={sv(name)}
              oninput={(e: Event & { currentTarget: HTMLInputElement }) => v.onInput(e.currentTarget.value)}
            />
          </PanelField>
        {/each}
    </section>
