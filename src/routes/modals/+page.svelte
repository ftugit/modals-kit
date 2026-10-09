<script lang="ts">
  // 6.4: тот же путь выключения, что у пагинаторной панели (гейт гидратации + общая причина).
import { Button } from '$lib/ui/primitives'
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
  import { entryLabel } from '$lib/modals'
  import { ModalTrigger, useModals } from '$lib/modals/svelte'
  import { CloseAllButton, modalTriggerVariants } from '$lib/ui/modals'
  import LoadLink from '$lib/router/LoadLink.svelte'
  import SettingsPanel from '$lib/ui/demo/modals/SettingsPanel.svelte'
  import SourcesPanel from '$lib/ui/demo/modals/SourcesPanel.svelte'
  import FloatingMenu from '$lib/ui/demo/modals/FloatingMenu.svelte'

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
          <Button variant="plain" size="none"  class={modalTriggerVariants()} onclick={openStorageless}>
            Модалка без хранилища
          </Button>
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

      <SettingsPanel />

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
      <Button variant="plain" size="none"
        
        class={modalTriggerVariants()}
        onclick={() => m.modals.open('select', { stack: 'new' })}
      >
        Перейти на демо-модалку
      </Button>
    </div>
    <p class="m-0 text-xs text-muted-foreground">
      Переход начинает новую стопку: несериализуемая запись не может оказаться
      под зарегистрированной — адрес кодирует параметры позиционно.
    </p>
  </div>
{/snippet}
