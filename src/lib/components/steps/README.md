# Шаги — `useSteps` / `Steps` / `StepLink`

Шаг — состояние страницы, которое пользователь видит как «место в процессе»
(мастер, регистрация, конструктор). Хост не знает ни про формы, ни про
содержимое: на шаги нарезается что угодно.

Три части:

| Что | Зачем |
|---|---|
| `useSteps(опции)` | хост: состояние шага, адрес, замок полёта, аргументы |
| `Steps` | навигация по шагам + **окно содержимого** (рисует сниппет текущего шага) |
| `StepLink` | ссылка на отдельный шаг (вся сантехника — из хоста) |

---

## 1. Быстрый старт (это работает как есть)

```svelte
<script lang="ts">
  import { Steps, StepLink, useSteps } from '#lib/components/steps/index.js'

  const steps = useSteps({
    owner: 'checkout',                          // владелец брони ключа (уникален)
    steps: () => [
      { key: 'cart',    label: 'Корзина',   filled: true },
      { key: 'address', label: 'Адрес',     filled: true },
      { key: 'done',    label: 'Готово',    filled: true },
    ],
    current: () => (data.step ?? 'cart'),       // начальный шаг — из данных load
  })
</script>

<!-- навигация: ссылки + подсветка текущего -->
<Steps host={steps} label="Оформление" />

<!-- содержимое: здесь рисуется ТЕКУЩИЙ шаг -->
<Steps host={steps} label="" nav={false}>
  {#snippet cart()}<CartList />{/snippet}
  {#snippet address()}<AddressForm />{/snippet}
  {#snippet done()}<p>Спасибо за заказ</p>{/snippet}
</Steps>
```

Открыть второй шаг сразу: `/checkout?step=address` — шаг читается из адреса.

## 2. Где рисуется текущий шаг (два способа)

**Способ А — сниппеты `Steps`** (пример выше): сниппет с именем ключа шага.
Это и есть окно содержимого; навигация (`nav`) и содержимое — один компонент,
`nav={false}` оставляет только окно.

**Способ Б — свои компоненты через `currentKey`:** когда шагов много или
содержимое тяжёлое:

```svelte
{#if steps.currentKey === 'cart'}
  <CartList />
{:else if steps.currentKey === 'address'}
  <AddressForm />
{/if}
```

`currentKey` реактивен: после клика по ссылке (или `set()`) окно переключается.

## 3. Ссылки на шаг: `StepLink` — без ручного onclick

```svelte
<StepLink host={steps} step="address" class="...">К адресу</StepLink>
```

`href` и обработчик клика `StepLink` берёт из хоста (те же атрибуты даёт и функция `stepLink` — §4):

- режим `url` — ссылка ведёт на адрес шага, клик — нативная навигация;
- режимы `local`/`hybrid` — клик перехватывается и вызывает `host.switch()`
  (локальная смена, `href` остаётся fallback для браузера без JS);
- во время полёта отправки (замок) — видна, но некликабельна (`aria-disabled`).

Текущий шаг ссылкой не бывает: `StepLink` на него рисует текст с
`aria-current="step"`. Если нужны свои классы подсветки — берите данные из
`steps.items` (массив с `current`/`locked`/`loading`/`href`).

## 5. Вид ссылки: `<a>` или кнопка — решаете вы (паттерн `asLink`)

Вид даёт ЭЛЕМЕНТ, атрибуты даёт хост — как `asLink` у `components/links`:

```svelte
<script lang="ts">
  import { stepLink } from '#lib/components/steps/index.js'
</script>

<!-- обычная ссылка -->
<a {...stepLink(steps, 'address')}>К адресу</a>

<!-- ссылка в облике кнопки: Button по ключу href рисует <a> с видом кнопки;
     БЕЗ JS разметка остаётся честной ссылкой -->
<Button {...stepLink(steps, 'address')} variant="outline">К адресу</Button>

<!-- на любом своём элементе -->
<span {...stepLink(steps, 'address')} class="cursor-pointer">…</span>
```

Атрибуты несут `href` (fallback без JS — нативный переход), `aria-disabled`
при замке и attachment-перехват клика: `url` — не трогает, `local`/`hybrid` —
`host.switch()` (он же уважает замок; модификаторы/средняя кнопка — браузеру).

Компонент `StepLink` — одна строка для любого вида: проп `element="button"`
даёт кнопку-ссылку (вид кнопки, элемент `<a>`, `aria-disabled` при замке):

```svelte
<StepLink host={steps} step="address">К адресу</StepLink>
<StepLink host={steps} step="address" element="button" variant="outline">К адресу</StepLink>
```

Текущий шаг `StepLink` рисует текстом с `aria-current="step"` — ссылкой он не бывает.

## 6. URL до шага и свой ключ

Адрес шага: `?<key>=<ключ шага>`. По умолчанию ключ `step`:

```
/checkout?step=address
```

Свой ключ — опция `key` (нужен, если на приложении `step` уже занят другим
потребителем — бронь ключей глобальна, см. §9):

```ts
const steps = useSteps({
  owner: 'auth',
  key: 'stage',            // теперь адреса выглядят как ?stage=register
  /* … */
})
```

```
/user/auth?stage=register
```

Адрес программно: `steps.href('address')` — только свой ключ, чужие параметры
адреса (`?modal=`, `?page.…`) не теряются. Deep-link подхватывается сам:
начальный шаг приходит из данных load (опция `current`), ссылку можно
отправить кому угодно.

## 6. Режимы: где живёт состояние

| Режим | Состояние | С JS | Без JS | Когда |
|---|---|---|---|---|
| `url` (умолчание) | адрес | клик = навигация | то же — **одинаково** | классический мастер |
| `local` | внутри хоста | клик меняет локально, адрес не пишется | fallback: переход по href | модалки (нельзя уезжать со страницы) |
| `hybrid` | внутри хоста + адрес своим ключом | клик меняет локально, адрес обновляется без навигации и load | fallback: переход по href | страницы, где смена шага не должна дёргать сервер |

В `local`/`hybrid` с JS и без JS шаги показываются одинаково — отличается
**механика** смены (локально против перехода). Fallback честный всегда: `href`
в разметке остаётся, поэтому без скриптов всё продолжает работать через адрес.

В `hybrid` после локальной смены адрес синхронизируется своим ключом
(`?step=…`, или своим `key`) через `pushState` — обновление страницы и
deep-link остаются верными, load не вызывается. Служебные состояния, которых
нет в списке `steps` (например, «blocked»), адреса не получают — только
локально.

## 7. Своё поведение при смене шага: `onSwitch`

Побочные данные шага (сгенерировать ключ, подтянуть данные) — опция `onSwitch`
хоста, а не обработчик ссылки:

```ts
const steps = useSteps({
  owner: 'auth',
  mode: 'hybrid',
  key: 'stage',
  steps: () => [
    { key: 'entry', label: 'Вход', filled: true },
    { key: 'register', label: 'Регистрация', filled: true },
  ],
  current: () => (data.step ?? 'entry'),
  onSwitch: (to) => switchStep(to),   // вызывается вместо set() при клике по ссылкам
})

async function switchStep(to: 'entry' | 'register'): Promise<void> {
  if (steps.currentKey === to) return
  localSeed = to === 'register' ? (await generateKeyPair()).secret : null
  steps.set(to)   // сам смену делает тут; так можно сделать что-то ДО неё
}
```

Все ссылки хоста (`StepLink`, навигация `Steps`) пойдут через `onSwitch`.
В режиме `url` клики не перехватываются вовсе — навигация нативная.

## 8. Несколько хостов на странице

Работают одновременно; каждому — **свой `key`** (и свой `owner`):

```ts
useSteps({ owner: 'catalog-filters', key: 'view',  /* … */ })
useSteps({ owner: 'checkout',        key: 'step',  /* … */ })
useSteps({ owner: 'modal-wizard',    mode: 'local', /* адреса нет — key не участвует */ })
```

Попытка занять занятый ключ падает ошибкой брони с именем владельца
(`«step» уже забронирован «fields» (претендент: …)`) — берите другой `key`.

## 9. С формой (`lib/form`): шаги как срезы одной формы

Форма ОДНА — привязка одна; шаги показывают **свои поля**, валидация и
отправка общие. Полный пример с описанием формы (объявление `myForm` —
изоморфное: импортируют и страница, и экшен):

```ts
// $lib/my-form.ts — описание (без UI, без HTTP)
import { defineForm, field, v } from '#lib/form/index.js'

export const myForm = defineForm({
  id: 'my-form',
  revision: 1,
  actions: [
    { id: 'save', label: 'Сохранить', validate: 'full' },
  ],
  fields: {
    title: field.text({ label: 'Название', validate: [v.required()] }),
    // note обязателен К ВВОДУ — но на втором шаге (см. разметку ниже)
    note: field.text({ label: 'Примечание', validate: [v.required()] }),
  },
})
```

```svelte
<!-- +page.svelte -->
<script lang="ts">
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import { Field } from '#lib/components/form/index.js'
  import { Steps, StepLink, useSteps } from '#lib/components/steps/index.js'
  import { myForm } from '$lib/my-form.js'
  import { forms } from '#lib/components/form/forms.config.js'
  import { kitActionTransport } from '#lib/components/form/transport.js'

  let { data, form: actionResult } = $props()

  // привязка ОДНА на всю форму (не на шаг): состояние, значения, проверки — общие
  const bound = bind(forms, myForm, {
    action: '/my-form',
    transport: kitActionTransport('/my-form'),
    // результат экшена (без JS) — продолжение привязки
    continuation: actionResult?.result ?? null,
  })

  const steps = useSteps({
    owner: 'my-form',
    steps: () => [
      { key: 'main', label: 'Основное', filled: true },
      { key: 'extra', label: 'Дополнительно', filled: true },
    ],
    current: () => (data.step ?? 'main'),
  })
</script>

<Steps host={steps} label="Шаги" />

<Form id="my-form" form={bound} hiddenFields={bound.hidden()}>
  {#if steps.currentKey === 'main'}
    <Field of={bound.f.title} />
  {:else if steps.currentKey === 'extra'}
    <Field of={bound.f.note} />
  {/if}

  <StepLink host={steps} step="extra" element="button" variant="outline">Дальше</StepLink>

  <!-- общая отправка: сохраняет значения ВСЕХ посещённых полей -->
  <Button type="submit" name="intent" value="save" task={formTask(bound.state)}>Сохранить</Button>
</Form>
```

**Как форма знает, что `note` «ещё нет в UI»: никакой магии — она этого и не
должна знать.** Обязательность проверяется на отправке по ЗНАЧЕНИЯМ, а не по
DOM. Сценарии:

- **Оба шага пройдены → «Сохранить»** — `note` в состоянии формы, `required`
  проходит.
- **«Сохранить» с первого шага, `note` не вводили** — форма честно откажет:
  `note: Обязательное поле`. Поле не нарисовано — ошибка закрепится за полем
  и всплывёт, когда вы дойдёте до его шага. Если это не то поведение — не
  делайте поле обязательным; обязательность ввода, растянутого на шаги, —
  дело порядка шагов.
- **Перешли на второй шаг, не заполнив первый** — обязательное `title`
  откажет на отправке так же честно; шаги не «резервируют» обязательность.

Правила срезов:

1. **Перенос поля между шагами** = переставить `<Field of={bound.f.note} />`
   в другой шаг. Описание, правила и ошибки живут в ОПИСАНИИ формы, не в
   разметке шага.
2. **Значение поля, спрятанного на другом шаге, в отправку не попадёт** — его
   нет в DOM. Если значение должно пережить скрытие — храните его в состоянии
   формы (запись через `onInput`, как seed у авторизации) или держите поле
   скрытым (`Input type="hidden"`).
3. Ошибки поля видны там, где поле нарисовано; общие ошибки отправки — у
   общих элементов формы, а не у шага.

## 9а. Форм-режим: шаги управляют валидаторами (`formSteps` + `FormSteps`)

Свободные срезы §9 — для страниц, где шаги листают произвольный контент. Когда
шаги **ведут анкету** (10 шагов — 10 экранов одной формы), берите форм-режим:

- **форма одна** (`bind` один): значения живут в состоянии привязки, а свёрнутый
  шаг спрятан `<details>`-ом — его поля **не вырезаны из DOM** и едут в каждом
  POST;
- **шаг проверяет своё**: у экшена шага — `subset` из его полей (это уже умеет
  ядро lib/form: `validateForm` пропускает чужие поля на ОБЕИХ сторонах, кнопка
  сама получает `formnovalidate`). Финальный экшен без `subset` проверяет всё;
- **переход — submit, не ссылка**: `<Button type="submit" {...fs.submitOf('extra')}>Далее</Button>`
  — интенция экшена шага; следующий шаг сервер кладёт в `Result.data.step`
  (с JS), обёртка экшена — в ответ странице (без JS);
- **разбор после ошибки**: провал с ошибками на чужих шагах (практически —
  финальный `save`) раскрывает шаги с ошибками и сворачивает чистые в
  «Отобразить шаг N» (`<details>`: раскрывается без скрипта, summary скрывается
  CSS-ом, скрыть — кликом мимо с JS; открытое живёт до отправки). Только общая
  ошибка — всё свёрнуто, блок `Common` — единственный сигнал. Починили всё —
  разбор сам отпускает.

```ts
// описание: экшен шага = ключ шага (или opts.actionOf), финал — без subset
export const myForm = defineForm({
  id: 'my-form', revision: 1,
  actions: [
    { id: 'contacts', label: 'Далее', validate: 'partial', subset: ['name', 'email'] },
    { id: 'extra', label: 'Далее', validate: 'partial', subset: ['note'] },
    { id: 'save', label: 'Сохранить', validate: 'full' },
  ],
  fields: { /* … */ },
})
```

```svelte
<script lang="ts">
  const steps = useSteps({ owner: 'my-form', mode: 'local', steps: STEPS, current: initial })
  const bound = bind(forms, myForm, { action: '/my-form', transport: kitActionTransport('/my-form') })
  const fs = formSteps(bound, steps) // паразит: карта поле→шаг из subset'ов, разбор
</script>

<Form id="my-form" form={bound} hiddenFields={bound.hidden()}>
  <Common errors={bound.common} title="Форма не сохранена" />
  <FormSteps host={steps} fs={fs}>
    {#snippet contacts()}
      <Field of={bound.f.name} />
      <Field of={bound.f.email} />
      <Button type="submit" {...fs.submitOf('contacts')}>Далее</Button>
    {/snippet}
    {#snippet extra()}
      <Field of={bound.f.note} />
      <Button type="submit" {...fs.submitOf('extra')}>Далее</Button>
      <Button type="submit" variant="outline" {...fs.submitOf('save')}>Сохранить</Button>
    {/snippet}
    {#snippet done()}<p>Готово.</p>{/snippet}
  </FormSteps>
</Form>
```

Экшен на сервере — обычный приём lib/form (`createFormHandler`): провал
валидации subset-экшена оставляет юзера на его шаге (шаг вернёт обёртка
экшена), успех шага возвращает `{ data: { step: следующий } }`. Живой пример —
раздел 4 демо `/steps` (включая разбор: имя `ошибка` ловит только сервер).

**Когда НЕ форм-режим:** шаги из разных форм (`/fields`: сборка набора →
запись на нём → результат — три отдельные формы, шаги в адресе) и страницы,
где шаги листают произвольный контент (§9).

## 10. Бронь ключей глобальна

Реестр ключей адреса (`lib/address/keys`) один на приложение (SPA-сессия и
серверный процесс): один ключ — один владелец. Поэтому у каждого потребителя
свои: `/fields` — `step`, авторизация — `stage`, демо `/steps` — `ustep`,
`lstep`, `hstep`. `owner` — имя владельца в этой брони: править свой ключ
адреса может только он, конфликт ошибкой называет обоих.

## 11. Замок полёта, загрузка, аргументы

- **Замок полёта**: `lockKey` — ключ в `page.state`, который форма взводит на
  время отправки. Ссылки видимые, но некликабельные (`aria-disabled`, guard);
  `set()`/`switch()` во время замка игнорируются.
- **Индикатор перехода**: `items[].loading` — честный статус перехода именно
  на этот шаг (`linkTask`, без таймеров).
- **Аргументы шага**: `steps.arg('id')` — чтение `step.<ключ>.<имя>`;
  `steps.argHref({ id: 5 })` — правка своим владельцем (как у модалок).

## 12. Защита (dev, `console.warn` с рецептом)

- `set()` в режиме `url` — состояние там ведёт адрес; локальная смена нужна —
  режим `local`/`hybrid`.
- `switch()` в режиме `url` не вызывается (клики там нативные) — предупреждение.
- Дубликаты ключей в списке шагов — списком ведает владелец.

## Демо

`/steps` — адресные режимы (url/local/hybrid) на произвольном содержимом,
форм-режим с разбором после серверной ошибки и все опции хоста;
`/fields` — шаги из трёх разных форм с переносом прогресса в адресе;
`/user/auth` — `hybrid` на странице и `local` в модалке.
