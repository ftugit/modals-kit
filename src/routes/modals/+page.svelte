<script lang="ts">
  import { onMount } from 'svelte'
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
  import { entryLabel, type CloseAnimation, type MobileAnchor, type OpenAnimation, type StackAnimation, type TailDirection } from '$lib/modals'
  import { ModalTrigger, useModals } from '$lib/modals/svelte'
  import { CloseAllButton, modalTriggerVariants } from '$lib/ui/modals'
  import LoadLink from '$lib/router/LoadLink.svelte'
  import SourcesPanel from './SourcesPanel.svelte'
  import FloatingMenu from './FloatingMenu.svelte'
  import Segmented from '$lib/ui/demo/Segmented.svelte'
  import Control from '$lib/ui/demo/Control.svelte'

  // Живой контекст: геттеры видят смену ядра при смене источников.
  const m = useModals()
  const cfg = $derived(m.view.hostConfig)
  let hydrated = $state(false)
  onMount(() => { hydrated = true })

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
  const set = (patch: Record<string, unknown>) => m.modals.configure(patch)
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

    <fieldset disabled={!hydrated} data-js-only-settings="" class="m-0 min-w-0 border-0 p-0">
      <legend class="sr-only">Интерактивная демонстрация модальной системы</legend>
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
        {#if !hydrated}
          <p data-js-settings-note="" role="status" class="mb-3 text-xs text-muted-foreground">
            Интерактивные элементы включаются после загрузки JavaScript; ссылки на страницы доступны без него.
          </p>
        {/if}
        <div class="rounded-lg bg-muted p-2 font-mono text-xs text-muted-foreground">
          <!-- Считаем ВСЮ цепочку: пока открыт мобильный лист select, одна
               запись принадлежит системному оверлею (headless) — он без
               своего DOM, но модальность держит он. См. state.svelte.ts. -->
          в стопке: {m.view.chain.length} ·
          {m.view.chain.map((c) => entryLabel(c)).join(' → ') || 'пусто'}
        </div>
      </section>

      <section class="grid gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:grid-cols-2">
        <Control label="Мобильный режим (умолчание)">
          <Segmented
            value={cfg.defaultMobile ?? 'off'}
            onChange={(v) => set({ defaultMobile: v as MobileAnchor | 'off' })}
            options={[
              { value: 'off', label: 'выкл', hint: 'не прижимать автоматически; запись со своим mobile прижмётся всё равно' },
              { value: 'bottom', label: 'низ' },
              { value: 'top', label: 'верх' },
              { value: 'left', label: 'лево' },
              { value: 'right', label: 'право' },
            ]}
          />
        </Control>
        <Control label="Мобильный режим popup-меню (умолчание)">
          <Segmented
            value={cfg.floatingMobile === false ? 'off' : 'on'}
            onChange={(v) => set({ floatingMobile: v === 'on' })}
            options={[
              { value: 'on', label: 'как у модалок', hint: 'обычные меню становятся листом' },
              { value: 'off', label: 'выпадашка', hint: 'не влияет на Select: он всегда в потоке' },
            ]}
          />
        </Control>

        <Control label="Анимация открытия">
          <Segmented
            value={cfg.openAnimation}
            onChange={(v) => set({ openAnimation: v })}
            options={[
              { value: 'scale', label: 'scale' },
              { value: 'fade', label: 'fade' },
              { value: 'slide-up', label: 'slide' },
              { value: 'none', label: 'выкл' },
            ]}
          />
        </Control>
        <Control label="Анимация закрытия">
          <Segmented
            value={cfg.closeAnimation}
            onChange={(v) => set({ closeAnimation: v })}
            options={[
              { value: 'scale', label: 'scale' },
              { value: 'fade', label: 'fade' },
              { value: 'slide-down', label: 'slide' },
              { value: 'none', label: 'выкл' },
            ]}
          />
        </Control>
        <Control label="Анимация стопки">
          <Segmented
            value={cfg.stackAnimation}
            onChange={(v) => set({ stackAnimation: v })}
            options={[
              { value: 'cards', label: 'карты' },
              { value: 'deck', label: 'колода' },
              { value: 'fan', label: 'веер' },
              { value: 'none', label: 'выкл' },
            ]}
          />
        </Control>
        <Control label="Направление хвостов">
          <Segmented
            value={cfg.tailDirection}
            onChange={(v) => set({ tailDirection: v })}
            options={[
              { value: 'bottom', label: 'вниз' },
              { value: 'top', label: 'вверх' },
              { value: 'left', label: 'влево' },
              { value: 'right', label: 'вправо' },
              { value: 'none', label: 'выкл' },
            ]}
          />
        </Control>
        <Control label="Макс. высота модалки">
          <Segmented
            value={cfg.maxHeight ?? '80vh'}
            onChange={(v) => set({ maxHeight: v })}
            options={[
              { value: '60vh', label: '60vh' },
              { value: '70vh', label: '70vh' },
              { value: '80vh', label: '80vh' },
              { value: '90vh', label: '90vh' },
            ]}
          />
        </Control>
        <Control label="Очистка памяти после закрытия">
          <Segmented
            value={String(cfg.clearOnClose)}
            onChange={(v) => set({ clearOnClose: v === 'true' })}
            options={[
              { value: 'false', label: 'хранить' },
              { value: 'true', label: 'очищать' },
            ]}
          />
        </Control>
        <Control label={`Число хвостов: ${cfg.tailCount ?? 3}`}>
          <input
            type="range"
            min="0"
            max="6"
            value={cfg.tailCount ?? 3}
            oninput={(e) => set({ tailCount: Number(e.currentTarget.value) })}
            class="w-full accent-primary"
          />
        </Control>
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
