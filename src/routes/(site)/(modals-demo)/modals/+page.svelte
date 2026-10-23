<script lang="ts">
  // 6.4: тот же путь выключения, что у пагинаторной панели (гейт гидратации + общая причина).
import { asLink, useModalLink } from '#hooks/links/index.js'
  import { Button, buttonVariants, Fieldset, Spinner } from '#components/ui/index.js'
  import { JS_ONLY_REASON, useJsOnly } from '#hooks/js-only.svelte.js'
  const jsOnly = useJsOnly()

  // Порт src/features/modals/ModalsDemo.tsx оригинала: состав триггеров,
  // счётчик стопки, панель настроек. Хост — в КОРНЕВОМ layout (этап B):
  // страница читает живой контекст, а настройки шлёт через
  // modals.configure() — конфигурация хоста и так живёт в сторе ядра.
  // Отличия от оригинала (не фичи, а среда):
  //   • LoadLink (быстрый роутер) → `asLink` (`#components/links`):
  //     спиннер на ссылке, битая ссылка блокируется ядром через таблицу
  //     роутов (осмотр 1.10-2, №30/№31), `navigateOnError: false` держит
  //     ошибку загрузчика на ссылке;
  //   • «Pager Demo» → «Цикл» (/cycle): страницы /paginator в порте нет;
  //   • SourcesPanel — расширение порта: выбор источников цепочки
  //     (состояние приложения, sources.svelte.ts).
  import { entryLabel } from '#lib/modals/index.js'
  import { useModals } from '#lib/modals/svelte/index.js'
  import { CloseAllButton } from '#components/modals/index.js'
  import SettingsPanel from './SettingsPanel.svelte'
  import SourcesPanel from './SourcesPanel.svelte'
  import FloatingMenu from '../FloatingMenu.svelte'

  // Живой контекст: геттеры видят смену ядра при смене источников.
  const m = useModals()
  const asModalLink = useModalLink()
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

<div>
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
        <Button {...asLink('/')} variant="outline" size="sm">Главная</Button>
        <Button {...asLink('/cycle')} variant="secondary" size="sm">Цикл</Button>
      </div>
    </header>

    <Fieldset disabled={jsOnly()} data-js-only-settings="" legend="Демо модалок" legendVariant="hidden" class="block">
      <section class="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <!-- Обычные модалки НЕ копируют defaultMobile в override: направление
               остаётся политикой хоста и меняется вместе с его настройками. -->
          <Button {...asModalLink('card', { id: 7 })} variant="outline">
            Открыть карточку
          </Button>
          <Button {...asModalLink('card', { id: 42, slow: true })} variant="outline">
            С загрузчиком (до 3 c)
          </Button>
          <Button {...asModalLink('fullpage')} variant="outline">Полноэкранная</Button>
          <!-- Без параметров и override: стартовая точка browser-проверки потока. -->
          <Button {...asModalLink('flow-probe')} variant="outline">Проверить наследование</Button>
          <Button {...asModalLink('select')} variant="outline">Select внутри модалки</Button>
          <Button {...asModalLink('card', { id: 77 }, { noForward: true })} variant="outline">
            Без «Вперёд»
          </Button>
          <Button {...asModalLink('ghost')} variant="outline">Несуществующая</Button>
          <Button {...asModalLink('broken-route', { id: 1 })} variant="outline">
            Битый route
          </Button>
          <FloatingMenu
            label="Меню на странице"
            mobile="bottom"
            class={buttonVariants({ variant: 'outline' })}
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
            class={buttonVariants({ variant: 'outline' })}
            items={[
              { label: 'Эта кнопка всегда выпадашка', hint: 'sheetOnNarrow=false' },
              { label: 'Открыть карточку', onSelect: () => m.modals.open('card', { params: { id: 12 } }) },
              { label: 'Закрыть всё', onSelect: () => m.modals.closeAll() },
            ]}
          />
          <Button variant="outline" onclick={openStorageless}>
            Модалка без хранилища
          </Button>
          <CloseAllButton />
          <!-- ссылка на страницу, которая ждёт loader (1.5 c) и крутит
               спиннер, как триггер модалки (порт LoadLink оригинала — теперь Link) -->
          <Button {...asLink('/cards/501?slow=1')} variant="outline">
            Страница со спиннером
          </Button>
          <Button {...asLink('/no-such-page/1')} variant="outline">
            Битая ссылка
          </Button>
          <!-- исходы загрузчика: ошибка (страницу покажет её +error), ошибка
               с navigateOnError={false} (остаёмся, «!» на ссылке) и штатная
               переадресация — не ошибка -->
          <Button {...asLink('/cards/404?fail=1')} variant="outline">
            Загрузчик с ошибкой
          </Button>
          <Button {...asLink('/cards/404?fail=1&stay=1', { navigateOnError: false })} variant="outline">
            Ошибка — остаться на месте
          </Button>
          <Button {...asLink('/cards/307?moved=1')} variant="outline">
            Ссылка с переадресацией
          </Button>
          <!-- обычная ссылка: функция сама гасит переход -->
          <a {...asLink('?modal=card')}
            onclick={(event) => openFromEvent(event, 'card', { id: 99 })}
            class="text-sm font-medium text-foreground underline decoration-dotted underline-offset-4"
          >
            обычная ссылка в обход компонента
          </a>
          <!-- кнопка на незарегистрированную заблокирована сразу,
               поэтому саму ошибку показываем открытием в обход кнопки -->
          <a {...asLink('?modal=ghost')}
            onclick={(event) => openFromEvent(event, 'ghost')}
            class="text-sm font-medium text-destructive underline decoration-dotted underline-offset-4"
          >
            ошибка «нет такой модалки»
          </a>
        </div>
        <!-- Свой вид загрузки поверх того же `asLink`: вся карточка — ссылка,
             спиннер — оверлеем по `group-data-[state=loading]`. Общий значок
             перед текстом убран `before:hidden`. -->
        <a
          {...asLink('/cards/502?slow=1')}
          data-testid="overlay-card-link"
          class="group relative mb-3 block max-w-sm rounded-lg border border-border bg-background p-3 text-sm transition-colors before:hidden hover:bg-accent"
        >
          <span class="block font-medium">Карточка 502</span>
          <span class="block text-xs text-muted-foreground">Медленная страница (1,5 с): вся карточка — ссылка, загрузка — оверлеем</span>
          <span
            class="absolute inset-0 hidden place-items-center rounded-lg bg-background/70 group-data-[state=loading]:grid"
            aria-hidden="true"
          >
            <Spinner size="md" />
          </span>
        </a>
        <!-- Пока страница не ожила (и без JS) — тот же флаг, что гасит настройки: <noscript>
             не показал бы подсказку, когда JS включён, но ещё не загрузился. -->
        {#if jsOnly()}<p class="mb-3 text-xs text-muted-foreground" data-js-only-hint>Настройки неактивны — {JS_ONLY_REASON}.</p>{/if}
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
    </Fieldset>

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
      <Button variant="outline"
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
