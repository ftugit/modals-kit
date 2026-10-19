# Универсальная демо-панель — утверждённый дизайн

**Статус: этап 1 СДЕЛАН (`/steps`, ход 262; `ui`-компонент — по образцу фильтров, ход 263).** Решение владельца: «Давай делать
универсальную демо панель… на первом этапе только steps, а так абсолютно все носители
демо опций». Сделано: `#lib/components/demo` (схема-данные → форма → адрес через
`lib/address` → параметры наружу), `/steps` переведён, дефект тача закрыт; попутно
`lib/steps` стал строить ссылки от видимого адреса (иначе мелкие записи терялись).
Дальше — этапы 2–4: пагинатор/`db-demo`, модалки, формы: панель обязана заменить
КАЖДУЮ текущую демо-панель.

## Требование владельца (дословно, ход 10 и ход 262)

- ход 10: «изначально я просил компонент, который можно подключить в любом разделе»;
- ход 262: «демо панель должна делать все внутри. В неё нужно передать схему, ui как
  фильтры и получить от неё параметры которые подключаются к потребителям… через
  lib/address который сама демо панель подключит из схемы… снаружи будет ноль
  подключений, все, что нужно для работы со url, get, параметрами делаем сама демо
  панель»;
- там же: «если это условный провайдер, то панель генерирует объект ключ:значение, если
  это отдельная опция типа изменение card в пагинаторе, то панель просто передает
  значение которое подставляется в ifelse».

## Факты по разделам (сверено с кодом, ход 262)

| Раздел | Панель сейчас | Где истина | Кто пишет |
|---|---|---|---|
| `/steps` | руками в `steps/+page.svelte`: `defineForm` + `bind(url)` + `goto` | адрес `?demo/?nav/?filled`, читается `page.url` | сама страница (`demoHref` + полный `goto`) |
| `/paginator`, `/db-demo` | `PaginatorSettings` → `compileDemoPanelSchema` → `PaginatorSettingsForm` | хранилище пагинатора, адрес — у источника `url` | `setExtra`/`setPageSize`; ключи `page`/`page.*` бронирует адаптер пагинатора |
| `/modals` | `SettingsPanel.svelte` руками: `bind` без url + эффект-дифф | per-route конфиг модалок | `m.modals.configure(patch)` |
| `/form` | разметка в `form/+page.svelte`: `bind` без url | состояние страницы | `if/else` по значениям (`cardinality`, `ui`, песочница) |

Общее у всех четырёх: схема полей → `bind` → виджеты `#lib/components/settings`;
различается только «куда писать» и «кто читает». Ручной код в страницах — ровно
проводка этого «куда/кто».

## Формат приёмника (решение делегировано владельцем в ход 262)

Схема — данные, и она объявляет адресную политику поля. Панель:

1. **сама** бронирует свои ключи (`claimQuery(schema.id, …)`) и пишет адрес через
   `#lib/address` **мелкой записью** (`writeAddress(..., {load:false})`) — без полной
   навигации;
2. **сама** читает seed из видимого адреса (`visibleAddress()`, на сервере — `page.url`);
3. **сама** собирает href по правилам полей (умолчания не пишутся, тумблер выключен —
   `false`, смена сценарного поля пересобирает адрес сценария);
4. наружу отдаёт **параметры** — объект ключ:значение (`onParams`) и SSR-хелпер
   `demoParams(schema, url)` для no-JS и первого рендера.

Приёмники, которые не адрес:

- **пагинатор / `db-demo`** — ключи `page`/`page.*` уже бронированы адаптером URL
  пагинатора; поля панели объявляются `url:false`, значения уходят в параметры, а
  библиотека-потребитель подключает готовый адаптер (этап 2) — страница не пишет ни
  строки;
- **модалки** — `url:false`, параметры → `modals.configure` (адаптер `lib/modals`,
  этап 3);
- **формы** — `url:false`; значения подставляются в `if/else` (этап 4).

Поэтому «ноль подключений» = ноль ручной проводки адреса/seed/href/goto в странице;
подключение библиотеки-приёмника — одна функция самой библиотеки.

## Публичный API

```ts
// #lib/components/demo/index.js
export type DemoField =
  | { type: 'select'; key; label; options; defaultValue; hint?; jsOnly?;
      url?: DemoUrlPolicy | false; resetsScenario?;
      disabledWhen?(values): string | undefined;   // причина, по которой поле выключено
      hintOf?(values): string | undefined }        // подсказка, зависящая от значений
  | { type: 'toggle'; key; label; defaultValue; …те же }
  | { type: 'text';   key; label; defaultValue; …те же }
  | { type: 'divider'; label }

interface DemoUrlPolicy { key?: string; omitWhenDefault?: boolean }

interface DemoPanelSchema<V> {
  id: string          // владелец брони ключей и id формы
  action: string      // адрес нативного GET без JS
  fields: readonly DemoFieldSpec[]
  toParams?(values: V): Record<string, unknown>   // по умолчанию — значения как есть
  load?: boolean      // полная навигация вместо мелкой записи (по умолчанию false)
}

function defineDemoPanel<V>(schema): DemoPanelSchema<V>
function demoParams<V>(schema, url: URL | string): V   // SSR/no-JS/F5

// <DemoPanel {schema} onParams={(p) => (params = p)} footer={snippet} ui={Component}/>
```

### Своя разметка: `ui` — как `form` у фильтров

Панель — оболочка (форма, нативный GET, «Применить», адрес, бронь ключей);
`ui` — компонент приложения, который рисует ТОЛЬКО поля и расставляет их руками.
Он получает готовые вьюхи, как компонент фильтров получает `FilterFormProps`:

```ts
// DemoUiProps
{
  form: BoundForm                    // связывание панели (submitVisible и т. п.)
  schema: DemoPanelSchema            // данные: подписи, варианты, порядок
  values: Readonly<DemoValues>       // живые значения
  field(name): {
    v: FieldView                     // значение, attrs механизма, ошибки, подпись
    spec: DemoField                  // поле схемы
    disabled: boolean                // причина схемы или jsOnly до оживления
    hint: string | undefined         // причина сильнее статических подсказок
    options: { value; label; disabled }[]   // jsOnly-варианты уже погашены
  }
}
```

```svelte
<!-- steps/StepsDemoFields.svelte — живой пример -->
<script lang="ts">
  import type { DemoUiProps } from '#lib/components/demo/index.js'
  import { Field, Select, Toggle } from '#lib/components/settings/index.js'

  let { field, form }: DemoUiProps = $props()
  const mode = $derived(field('demo'))
</script>

<div class="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
  <div class="md:col-span-2">
    <Field label={mode.v.label} hint={mode.hint} hintId={`${mode.v.attrs.id}-help`}>
      <Select {...mode.v.attrs} name={mode.v.name} value={String(mode.v.value ?? '')}
              disabled={mode.disabled} options={mode.options} />
    </Field>
  </div>
  <!-- тумблеры рядом: hiddenPair={form.submitVisible}, как в каноне -->
</div>
```

```svelte
<DemoPanel schema={demoPanelSchema} ui={StepsDemoFields} onParams={(p) => (demo = p)} />
```

Правила остаются в данных: `jsOnly`, `disabledWhen`, `hintOf` живут в схеме, а не
в разметке — свой UI их не повторяет, а читает из `field(name)`.

Канон панели сохраняется: это ФОРМА (`data-testid="demo-panel"`), «Применить» живёт
только до оживления, jsOnly-варианты до оживления выключены (без подсказок в
вариантах), тумблеры несут hidden-пару до оживления, после оживления — живое
применение. `ui` (сниппет, как компонент формы у фильтров) — только раскладка; по
умолчанию — каноническая сетка.

## `/steps`: что переезжает

Страница теряет: `defineForm` панели, `demoHref`, `bind(url)`, `goto`, чтение
`?demo/?nav/?filled` руками. Остаётся: схема (в `fstep-form.ts`), `<DemoPanel>`,
`onParams` → состояние страницы и хелпер `demoParams` для SSR.

**Дефект тача и почему уходит.** Полный `goto`, начатый из-под модального слоя списка
(Select на узком экране пишет shallow-запись при открытии), SvelteKit молча отменяет —
URL возвращается к записи слоя. Панель пишет мелкой записью через адресного писателя:
полной навигации нет, столкновения нет; на десктопе поведение не меняется.

## Тесты

- юнит: seed из адреса (умолчания, `false`-пары, невалидный вариант), сборка href
  (умолчания не пишутся, чужие ключи живут, сценарная смена чистит адрес);
- браузер: `test/browser/steps.mjs` без правок (15 проверок), плюс тач-прогон
  (Pixel 7) смены режима — дефект владельца;
- гейты: svelte-check, build, budget, vitest `src/lib/components src/routes`.

## Вне этапа 1 (записано, чтобы не потерять)

- этап 2 — `PaginatorSettings` на общий компонент: `SettingsField[]` → `DemoField[]`,
  `compileDemoPanelSchema` уходит, поля `url:false` + адаптер `lib/paginate`;
  источник (localStorage/память) — единственное не-адресное поле, слот `store`;
- этап 3 — `SettingsPanel` модалок: `url:false` + адаптер `lib/modals`;
- этап 4 — панель `/form`: `url:false`, значения в `if/else`;
- лёгкий контур `bind` (вес: `bind` тянет весь `lib/form`) — отдельная задача, к
  владению адресом отношения не имеет.
