<script lang="ts">
  // 6.4: тот же путь выключения, что у пагинаторной панели (гейт гидратации + общая причина).
  import { JS_ONLY_REASON, useJsOnly } from '$lib/ui/js-only.svelte'
  const jsOnly = useJsOnly()

  // Порт src/features/modals/ModalsDemo.tsx оригинала: состав триггеров,
  // счётчик стопки, панель настроек. Хост — в КОРНЕВОМ layout (этап B):
  // страница читает живой контекст, а настройки шлёт через
  // modals.configure() — конфигурация хоста и так живёт в сторе ядра.
  // Отличия от оригинала (не фичи, а среда):
  //   • LoadLink (быстрый роутер) → порт src/lib/router/LoadLink.svelte:
  //     preloadData+goto и спиннер на ссылке, битая ссылка блокируется
  //     ядром через таблицу роутов (осмотр 1.10-2, №30/№31);
  //   • «Pager Demo» → «Цикл» (/cycle): страницы /paginator в порте нет;
  //   • SourcesPanel — расширение порта: выбор источников цепочки
  //     (состояние приложения, sources.svelte.ts).
  import { entryLabel, type MobileAnchor } from '$lib/modals'
  import { ModalTrigger, useModals } from '$lib/modals/svelte'
  import { CloseAllButton, modalTriggerVariants } from '$lib/ui/modals'
  import LoadLink from '$lib/router/LoadLink.svelte'
  import SourcesPanel from './SourcesPanel.svelte'
  import FloatingMenu from './FloatingMenu.svelte'
  import { bind, createConfig } from '$lib/form/svelte'
  import { defineForm, field } from '$lib/form'
  import { untrack } from 'svelte'
  import { Input } from '$lib/ui/primitives'
  import { Field as PanelField, Select as PanelSelect } from '$lib/ui/settings'

  // Живой контекст: геттеры видят смену ядра при смене источников.
  const m = useModals()
  /**
   * Модалка БЕЗ хранилища: `openLayer` кладёт в цепочку transient-запись.
   * Содержимое живёт в памяти вкладки, в адрес не попадает и перезагрузку
   * не переживает — зато у неё есть своя запись истории, «Назад» и место
   * в очереди закрытия.
   */
  function openStorageless() {
    m.modals.openLayer({ content: storagelessBody })
  }

  /** Вызов в обход компонента: сам гасит переход по ссылке
      (порт openModalFromEvent из registry.ts оригинала). */
  function openFromEvent(event: MouseEvent, name: string, params?: Record<string, unknown>) {
    event.preventDefault()
    event.stopPropagation()
    m.modals.open(name, params ? { params } : undefined)
  }

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

  const SETTINGS = ['default_mobile', 'floating_mobile', 'open_animation', 'close_animation',
                    'stack_animation', 'tail_direction', 'max_height', 'clear_on_close'] as const

</script>

<div class="py-10 sm:py-14">
  <div class="mx-auto max-w-4xl space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div class="space-y-2">
        <h1 class="text-4xl font-semibold tracking-tight">Модальная система</h1>
        <p class="max-w-2xl text-sm text-muted-foreground">
          Цепочка живёт в адресе: <code>?modal=card,card</code>. Назад/Вперёд закрывает и
          открывает верхнюю, холодный запуск открывает всю стопку.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <a
          href="/"
          class="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Главная
        </a>
        <a
          href="/cycle"
          class="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Цикл
        </a>
      </div>
    </header>

    <fieldset disabled={jsOnly()} data-js-only-settings="" class="m-0 min-w-0 border-0 p-0">
      <legend class="sr-only">Демо модалок</legend>
      <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <!-- Обычные модалки НЕ копируют defaultMobile в override: направление
               остаётся политикой хоста и меняется вместе с его настройками. -->
          <ModalTrigger name="card" params={{ id: 7 }}>
            Открыть карточку
          </ModalTrigger>
          <ModalTrigger name="card" params={{ id: 42, slow: true }}>
            С загрузчиком (до 3 c)
          </ModalTrigger>
          <ModalTrigger name="fullpage">Полноэкранная</ModalTrigger>
          <!-- Без параметров и override: стартовая точка browser-проверки потока. -->
          <ModalTrigger name="flow-probe">Проверить наследование</ModalTrigger>
          <ModalTrigger name="select">Select внутри модалки</ModalTrigger>
          <ModalTrigger name="card" params={{ id: 77 }} noForward>
            Без «Вперёд»
          </ModalTrigger>
          <ModalTrigger name="ghost">Несуществующая</ModalTrigger>
          <ModalTrigger name="broken-route" params={{ id: 1 }}>
            Битый route
          </ModalTrigger>
          <FloatingMenu
            label="Меню на странице"
            mobile="bottom"
            class={modalTriggerVariants()}
            items={[
              { label: 'Открыть карточку', hint: 'обычная модалка', onSelect: () => m.modals.open('card', { params: { id: 11 } }) },
              { label: 'Полноэкранная', onSelect: () => m.modals.open('fullpage') },
              { label: 'Недоступный пункт', disabled: true },
              { label: 'Закрыть всё', onSelect: () => m.modals.closeAll() },
            ]}
          />
          <FloatingMenu
            label="Меню без мобильного режима"
            sheetOnNarrow={false}
            class={modalTriggerVariants()}
            items={[
              { label: 'Эта кнопка всегда выпадашка', hint: 'sheetOnNarrow=false' },
              { label: 'Открыть карточку', onSelect: () => m.modals.open('card', { params: { id: 12 } }) },
              { label: 'Закрыть всё', onSelect: () => m.modals.closeAll() },
            ]}
          />
          <button type="button" class={modalTriggerVariants()} onclick={openStorageless}>
            Модалка без хранилища
          </button>
          <CloseAllButton />
          <!-- ссылка на страницу, которая ждёт loader (1.5 c) и крутит
               спиннер, как триггер модалки: порт LoadLink оригинала -->
          <LoadLink href="/cards/501?slow=1" class={modalTriggerVariants()}>
            Страница со спиннером
          </LoadLink>
          <LoadLink href="/no-such-page/1" class={modalTriggerVariants()}>
            Битая ссылка
          </LoadLink>
          <!-- обычная ссылка: функция сама гасит переход -->
          <a
            href="?modal=card"
            onclick={(event) => openFromEvent(event, 'card', { id: 99 })}
            class="text-sm font-medium text-foreground underline decoration-dotted underline-offset-4"
          >
            обычная ссылка в обход компонента
          </a>
          <!-- кнопка на незарегистрированную заблокирована сразу,
               поэтому саму ошибку показываем открытием в обход кнопки -->
          <a
            href="?modal=ghost"
            onclick={(event) => openFromEvent(event, 'ghost')}
            class="text-sm font-medium text-destructive underline decoration-dotted underline-offset-4"
          >
            ошибка «нет такой модалки»
          </a>
        </div>
        <noscript><p class="mb-3 text-xs text-muted-foreground">Без JS: неактивны — {JS_ONLY_REASON}.</p></noscript>
        <div class="rounded-lg bg-muted p-2 font-mono text-xs text-muted-foreground">
          <!-- Считаем ВСЮ цепочку: пока открыт мобильный лист select, одна
               запись принадлежит системному оверлею (headless) — он без
               своего DOM, но модальность держит он. См. state.svelte.ts. -->
          в стопке: {m.view.chain.length} ·
          {m.view.chain.map((c) => entryLabel(c)).join(' → ') || 'пусто'}
        </div>
      </section>

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

      <!-- Панель источников — под хостом (он в корневом layout): её select
         на узком экране получает слой хоста. Источники — состояние
         приложения (sources.svelte.ts), панель пишет прямо в него. -->
      <SourcesPanel />
    </fieldset>

    <p class="text-xs text-muted-foreground">
      В мобильном режиме размеры не действуют: модалка занимает всю ширину (верх/низ) или всю
      высоту (лево/право), радиус с прижатой стороны снимается, а хвосты уходят в
      противоположную сторону.
    </p>
  </div>
</div>

<!--
  Содержимое модалки БЕЗ хранилища. Передаётся в `openLayer` как сниппет:
  ядру оно непрозрачно, разворачивает его слой вида (`ModalContent`).

  Внутри — всплывающее меню (тот же `host.floating`) и переход на обычную,
  зарегистрированную модалку. Переход идёт со `stack: 'new'`: transient-запись
  обязана быть на вершине цепочки (`assertTransientOnTop`), поэтому
  зарегистрированная модалка не ложится поверх неё, а начинает новую стопку.
-->
{#snippet storagelessBody()}
  <div class="flex flex-col gap-3 p-5">
    <h2 class="m-0 text-lg">Модалка без хранилища</h2>
    <p class="m-0 text-sm text-muted-foreground">
      Это <b>transient</b>-запись: содержимое живёт в памяти вкладки, в адрес не попадает
      и перезагрузку не переживает. При этом у неё есть своя запись истории — «Назад»
      закрывает именно её — и место в очереди закрытия.
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <FloatingMenu
        label="Меню в этой модалке"
        items={[
          { label: 'Ничего не делать', hint: 'просто закрыть' },
          { label: 'Закрыть эту модалку', onSelect: () => m.modals.close() },
          { label: 'Закрыть всё', onSelect: () => m.modals.closeAll() },
        ]}
      />
      <button
        type="button"
        class={modalTriggerVariants()}
        onclick={() => m.modals.open('select', { stack: 'new' })}
      >
        Перейти на демо-модалку
      </button>
    </div>
    <p class="m-0 text-xs text-muted-foreground">
      Переход начинает новую стопку: несериализуемая запись не может оказаться
      под зарегистрированной — адрес кодирует параметры позиционно.
    </p>
  </div>
{/snippet}
