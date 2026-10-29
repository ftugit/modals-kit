# form — формы без HTML-элементов

Изоморфная библиотека форм: **описание — данные, разметка — приложение, ядро — один и тот же
код в браузере и на сервере**. Библиотека не создаёт ни одного DOM-элемента: она считает
атрибуты, проверяет значения, принимает запрос и решает, что показывать. Теги расставляет
приложение — поэтому ядро не привязано к движку, а адаптер движка остаётся тонким слоем.

```
описание(поля, правила) → связывание(настройка) → наборы пропсов → ваша разметка
```

Готовый адаптер движка: `svelte/` (см. [Адаптеры движков](#адаптеры-движков)).
Ядро покрыто модульными тестами, а вес и чистоту слоёв охраняют автоматические
стражи: бюджет каждого адаптера — отдельной строкой.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Как это устроено](#как-это-устроено)
- [Как подключить к своему движку](#как-подключить-к-своему-движку)
- [Адаптеры движков](#адаптеры-движков)
- [Как создать свой хук](#как-создать-свой-хук)
- [Фронтенд и бэкенд одновременно](#фронтенд-и-бэкенд-одновременно)
- [Встроенные представления](#встроенные-представления)
- [Каталог валидаторов](#каталог-валидаторов)
- [Бюджет тела и файлов](#бюджет-тела-и-файлов)
- [Как добавить свой валидатор](#как-добавить-свой-валидатор)
- [Как фильтровать данные](#как-фильтровать-данные)
- [Выключение полей по значениям](#выключение-полей-по-значениям)
- [Неродные поля → родные значения](#неродные-поля--родные-значения)
- [Как описывать чужие службы](#как-описывать-чужие-службы)
- [Асинхронные проверки](#асинхронные-проверки)
- [Перехват поля: клиентская подготовка значения](#перехват-поля-клиентская-подготовка-значения)
- [Поля из рантайма](#поля-из-рантайма)
- [Набор полей от пользователя](#набор-полей-от-пользователя)
- [Внешние схемы](#внешние-схемы)
- [Правила из чужой схемы, `pick` и `prepare`](#правила-из-чужой-схемы-pick-и-prepare)
- [Политика: пределы, имена, конверт](#политика-пределы-имена-конверт)
- [Исходы отправки](#исходы-отправки)
- [Отправка как задача: `formTask`](#отправка-как-задача-formtask)
- [Проверки и бюджеты](#проверки-и-бюджеты)

---

## Быстрый старт

Описание — изоморфный модуль: его импортируют и страница, и сервер. Ноль UI, ноль HTTP,
ноль Svelte — чистый TypeScript.

```ts
// signup.ts — описание: изоморфный модуль, его импортируют обе стороны
import { defineForm, field, v } from '#lib/form/index.js'

export const signup = defineForm({
  id: 'signup',
  revision: 1,
  cardinality: 'first',                       // одна ошибка на поле
  actions: [
    { id: 'submit', label: 'Создать аккаунт', validate: 'full' },
    { id: 'save-draft', label: 'Черновик', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    email:    field.email({ label: 'Почта', validate: [v.required(), v.email()] }),
    password: field.password({ label: 'Пароль',
      validate: [v.required(), v.minLength(10), v.strength('good')] }),
    confirm:  field.password({ label: 'Повторите пароль',
      validate: [v.required(), v.sameAs('password')] }),      // проверяет сервер
    agree:    field.checkbox({ label: 'Согласен с условиями', validate: [v.required()] }),
  },
})
```

Связывание в Svelte (проектная настройка один раз, форма — одной строкой):

```ts
// forms.config.ts — настройка проекта: один раз на приложение
import { createConfig } from '#lib/form/svelte/index.js'
import TextField from './ui/TextField.svelte'   // компоненты пишет приложение
import CheckboxField from './ui/CheckboxField.svelte'

export const forms = createConfig({
  resolve: (f) =>
    f.input === 'checkbox' ? CheckboxField :
    f.input === 'password' ? PasswordField : TextField,
  // transport, live, parallel, onErrors, invalidFrom, ui — при желании
})
```

```svelte
<!-- +page.svelte -->
<script>
  import { bind } from '#lib/form/svelte/index.js'
  import { forms } from './forms.config'
  import { signup } from './signup'
  const form = bind(forms, signup, { onErrors: handler })
</script>

<form {...form.formProps()}>
  {#each form.hidden() as h (h.name)}<input {...h} />{/each}   <!-- конверт -->

  {#if form.common.length}<div role="alert">{form.common[0].message}</div>{/if}

  {#each [form.f.email, form.f.password] as f}
    <label {...f.labelProps()}>{f.label}</label>
    <input {...f.attrs} oninput={(e) => f.onInput(e.currentTarget.value)}
           onblur={() => f.setTouched()} />
    {#if f.errors[0]}<p {...f.errorProps()}>{f.errors[0].message}</p>{/if}
  {/each}

  <button {...form.intent('submit')}>Создать аккаунт</button>
</form>
```

`f.attrs` уже содержит всё, что должно быть на элементе: `type`, `minlength`,
`aria-invalid`, `aria-describedby`, `id`, `name`. Приложение только разворачивает
пропсы — забыть связку доступности нельзя, потому что нечего забывать.

## Как это устроено

| Слой | Файлы | Ответственность |
|---|---|---|
| описание | `describe.ts`, `policy.ts`, `registry.ts` | черновик → провалидированное неизменяемое описание |
| типы значения | `field-types.ts`, `builtins.ts`, `constraints.ts` | разбор записей, проекция ограничений в атрибуты |
| правила | `validators.ts`, `strength.ts`, `async.ts`, `schema.ts` | синхронные, асинхронные, внешние источники ошибок |
| проверка | `decode.ts`, `validate.ts`, `result.ts`, `messages.ts` | FormData → значения → ошибки с текстами |
| показ | `errors.ts` | факт/показ, общие/поля, подсветка |
| отправка | `envelope.ts`, `submit.ts`, `state.ts` | конверт, конвейер, гонки, состояние |
| приём | `server.ts` | переставляемые слои, идемпотентность, частота |
| динамика | `spec.ts`, `kit.ts`, `field-set.ts`, `source.ts` | поля из данных, набор полей от пользователя, источник описания, устаревание |
| обвязки | `svelte/` | единственное место, где ядро встречается с фреймворком |

Три правила, которые не нарушаются:

1. **Ядро не знает фреймворка.** В файлах ядра нет ни одного импорта вне
   относительных путей; зоны адаптеров (сейчас одна — `svelte/`) — отдельные
   слои, и пакет движка разрешён только в своей зоне. Страж проверяет это на
   каждом прогоне.
2. **Граница «разметка — данные».** Библиотека не создаёт элементов и не знает,
   как выглядит поле. Она даёт готовый набор пропсов.
3. **Один код-путь.** Перехваченная отправка в браузере и нативный POST на сервере
   исполняют один и тот же `evaluate()`. Расхождение путей невозможно по построению.

## Как подключить к своему движку

Ядро приезжает исходниками и не зависит от сборщика. Схема для любого фреймворка:

1. **Импорт исходников.** Никаких пакетов — прямой импорт модулей по полному пути
   через `imports` в `package.json` (в этом репозитории `#lib/*` → `src/lib/*`):

   ```ts
   import { defineForm, field, v } from '#lib/form/index.js'     // ядро
   import { bind, Form } from '#lib/form/svelte/index.js'        // адаптер Svelte
   import { createFormHandler } from '#lib/form/server.js'       // серверная половина
   ```

   В `index.ts` нет ни одного фреймворка: точка входа ядра чиста. Зоны библиотеки —
   отдельные точки входа: `svelte/index.ts` и `server.ts`.

2. **Реализовать транспорт** — единственное место, где ядро касается сети:

   ```ts
   import type { Transport } from '#lib/form/index.js'

   export const fetchTransport: Transport = async (req) => {
     const r = await fetch(url, { method: 'POST', body: req.data, signal: req.signal })
     const json = await r.json().catch(() => null)
     return json ? { kind: 'result', result: json } : { kind: 'network', code: 'network.failed' }
   }
   ```

3. **Взять из ядра готовое** — всё, кроме реактивности, уже написано:

   | Что | Откуда |
   |---|---|
   | состояние и подписка | `FormStore` (`state.ts`) — `getSnapshot/subscribe/set`, готово для `useSyncExternalStore` |
   | проверка | `evaluate()` (`submit.ts`) — одна функция для обоих путей |
   | отправка и гонки | `runSubmit`, `SubmitMachine` (`submit.ts`) |
   | показ | `applyHandler`, `split`, `hasError`, `invalidFromFor` (`errors.ts`) |
   | асинхронные проверки | `AsyncRunner` (`async.ts`) |
   | конверт | `buildEnvelope` (`envelope.ts`) |

4. **Взять готовый слой реактивности** — для Svelte он уже написан:
   см. [Адаптеры движков](#адаптеры-движков). Для другого движка — раздел «Как создать свой хук»;
   эталонная реализация: [`svelte/bind.svelte.ts`](./svelte/bind.svelte.ts)
   (~600 строк, треть — комментарии).

## Адаптеры движков

Сейчас зона одна — `svelte/` (`#lib/form/svelte/index.js`). Адаптеры React и Solid удалены
(аудит, C9): они не использовались, не проверялись тестами и уже разошлись со
Svelte-версией; будут написаны заново по тому же контракту.

Контракт зоны: настройка проекта один раз (`createConfig` → `BoundConfig`), связка
одной строкой (`bind(forms, signup, opts)`), дальше — наборы пропсов для вашей
разметки (`form.f.email`, `labelProps` → `for`, атрибуты — HTML-имена, `minlength`).
Состояние — руны. Настройка `createConfig`: `transport`, `live`, `parallel`,
`onErrors`, `invalidFrom`, `ui` и `resolve` — «представление → компонент».

## Как создать свой хук

Хук приложения — тонкая обёртка над адаптером, чтобы не повторять настройку на каждой
форме. Библиотека фабрики хуков не поставляет: это право приложения. Ниже — полный
каркас адаптера на React (эталон — [`svelte/bind.svelte.ts`](./svelte/bind.svelte.ts)):

```ts
// form/use-form.ts — адаптер React: useState над FormStore
import { useSyncExternalStore } from 'react'
import {
  FormStore, initialState, SubmitMachine, runSubmit, evaluate,
  applyHandler, split, hasError, invalidFromFor,
  AsyncRunner, buildEnvelope, en, makeRenderer, mergeChecks,
} from '#lib/form/index.js'

export function useForm(description, opts) {
  const store = useRef(new FormStore(initialState(description.revision)))
  const machine = useRef(new SubmitMachine(opts.parallel ?? 'block'))
  const merged = mergeChecks(description.checks, opts.checks)
  const runner = useRef(merged ? new AsyncRunner(merged) : null)

  // снимок для рендера: getSnapshot стабилен по ссылке — иначе цикл
  const state = useSyncExternalStore(
    store.current.subscribe, store.current.getSnapshot, store.current.getSnapshot)

  // ... скрытые поля, viewOf(), submit(), lift() — как в svelte/bind.svelte.ts

  return { state, f, formProps, hidden, intent, submit, lift }
}
```

Свои настройки, которые хук обычно выставляет (все — из `FormsConfig` в `config.ts`
зоны адаптера: [`svelte/`](./svelte/config.ts)):

| Настройка | Тип | Что решает |
|---|---|---|
| `resolve` | функция | «представление → компонент», только в svelte-адаптере. Умолчаний нет: забыли — ошибка конфигурации |
| `transport` | `Transport` | как уезжает перехваченная отправка |
| `live` | `'on-submit' \| 'on-blur' \| 'on-input' \| 'after-touched'` | когда поле перепроверяется |
| `parallel` | `'block' \| 'replace' \| 'queue'` | `block` отклоняет параллельный запуск, `replace` отменяет текущий, `queue` ждёт освобождения слота и затем выполняет отправку |
| `onErrors` | `ErrorHandler` | обработчик ошибок проекта |
| `messages` | `MessageDictionary` | словарь системных сообщений приложения (ядро поставляет `en`; русский словарь подключён в UI-слое `src/components/form/messages.ru.ts`, а `bind()` переводит им и клиентские, и серверные коды `Result`) |
| `invalidFrom` | `'fact' \| 'shown'` | источник подсветки по умолчанию |
| `ui` | `Partial<UiPolicy>` | идентификаторы, `aria-describedby`, эскалация живой проверки |

Про `ui`-политику: `fieldId`, `describedBy`, `shouldValidate`, `valueAttrs` — четыре
функции сборки пропсов. Подмените их в настройке, если нужны свои идентификаторы
или другое правило перепроверки: настройка принимает `Partial<UiPolicy>`, а не
применяется целиком — умолчания остальных функций живут.

Все адаптеры читают имя intent-поля из `policy.envelopeKeys.intent`: скрытый
конверт, кнопки действий и разбор `FormData` используют один policy-driven ключ.
Svelte-связка также предоставляет `form.redisplay()` — повторное применение
текущего `onErrors` к сохранённым фактам без сети и повторной валидации.

## Фронтенд и бэкенд одновременно

Модуль описания импортируют обе стороны. Сервер не доверяет клиенту ничего:
набор полей, ревизия и правила приходят из кода, а не из запроса.

```ts
// сервер: приём запроса — переставляемые слои
import { createFormHandler, MemoryIdempotencyStore } from '#lib/form/server.js'
import { signup } from './signup'

const handle = createFormHandler({
  description: signup,                        // checks, budget и limits приходят из defineForm
  idempotency: new MemoryIdempotencyStore(),
  onErrors: (errors, ctx) => errors,          // проходят ОБА пути
  execute: async (ctx) => {
    // ctx.values — типизированные и проверенные значения
    const id = await createAccount(ctx.values)
    ctx.commit()                               // без commit() исход — 'unknown'
    return { data: { id } }
  },
})
```

Пределы приёма — `Limits` (`server.js`): `budget` — вес тела, `maxKeys` —
различных ключей, `maxValuesPerKey` — значений одного ключа, `timeoutMs` — крайний
срок всего приёма (по умолчанию 15 с). Изоморфные `maxKeys`, `maxValuesPerKey` и
`timeoutMs` объявляются один раз в `defineForm({ limits })`, а `budget` — в
`defineForm({ budget })`. Срок считается от первого байта тела до
готового `Result`: висящее чтение тела, молчащий обработчик и зависшее хранилище
обрываются одинаково — `408 request.timeout`. Работа не прерывается (чужой
`execute` не остановить), поэтому исход честный: `not-applied`, если действие не
начинали, `unknown`, если начали без `commit()`, `committed`, если успели его
позвать. Тело запроса при срочном отказе отменяется. Предела на отдельный файл
здесь нет: его объявляет `v.maxSize` в описании формы, а общий вес держит бюджет
(см. «Бюджет тела и файлов»). `envLimits`
приложения ставит `budget` из `FORM_BODY_LIMIT`, частные `limits` регистрации
его только уменьшают.

`onErrors` получает фактический intent текущей отправки. Сбои задач,
зарегистрированных через `ctx.after()`, не отменяют зафиксированное действие и
возвращаются в `Result.warnings`. Пользовательский `order` серверных слоёв обязан
содержать `bodyLayer` и `namesLayer`; обработчик проверяет этот инвариант при
создании.

Два пути, один семантический контракт:

| Путь | Как | Где обработчик `onErrors` | Что возвращает |
|---|---|---|---|
| `action` | обычный POST, страницу рисует сервер | на сервере | HTML с ошибками в разметке |
| `fetch` | тот же адрес, JSON из `fetch` | в браузере | `Result` в JSON |

`Result.from` — свойство результата, а не момент отрисовки: повторная отрисовка
на клиенте не пересчитывает его, показ не меняется после оживления. Обработчик
обязан быть изоморфным; браузерные вызовы — только под `ctx.from === 'fetch'`.

`Result.intent` — намерение конверта, которым получен результат (действие и
аргумент, как в конверте): обработчик и конвейер отправки штампуют его по факту
разбора конверта — на успехе, отказе `execute` и провале проверки одинаково (до
разбора конверта штампа нет). По нему показ различает, каким действием
отправлена форма, не гадая по ошибкам; у результата, собранного приложением
вручную, поля может не быть.

Браузерная сторона при перехвате проходит **тот же** `evaluate` (см. `runSubmit`),
поэтому «клиент пропустил — сервер заругался» невозможно: расхождение путей
ловят тесты сравнением списков ошибок.

Приём в SvelteKit: `+page.server.ts` вызывает `handle(request, 'action')` и
отдаёт `result` в `form`, `+server.ts` — `handle(request, 'fetch')` и `json(...)`.
В других движках — серверная функция или роут того же движка: адрес один,
контракт `Result` тот же.

## Встроенные представления

Представление (`input`) — то, как поле выглядит; тип значения (`kind`) — что из него
декодируется. `field.<представление>(...)` находит тип по представлению. Библиотека
отдаёт только `attrs`; компонент под представление выбирает приложение в `resolve`
(в демо — `src/components/form/resolve.ts`, примитивы — `#components/ui`).

| Представление | Тип значения | Атрибуты типа | Компонент демо → примитив |
|---|---|---|---|
| `text`, `email`, `url`, `tel`, `color` | `text` | `type` | `TextField` → `Input`; с `variant: 'auto'` — `Input autoWidth` (ширина по тексту); у `color` пустое значение показывается как `defaultValue` |
| `hidden` | `text` | `type="hidden"`, `required` не выводится | `HiddenField` → `Input` без подписи и подсказки |
| `password` | `text` | `type="password"`, значение не возвращается в разметку | `PasswordField` → `PasswordInput` (показ пароля после оживления); с `variant: 'strength'` — `PasswordStrengthField` → `PasswordStrength` (тот же `PasswordInput` + шкала по `strengthOf`) |
| `search` | `text` | `type="search"` | `SearchField` → `SearchInput` (крестик очистки после оживления) |
| `otp` | `text` | `type="text" inputmode="numeric" autocomplete="one-time-code"` | `OtpField` → `OtpInput` (ячейки после оживления; число ячеек — из `v.maxLength(n)`, без него 6) |
| `textarea` | `text` | — | `TextareaField` → `Textarea`; с `variant: 'auto'` — `AutoTextareaField` → `AutoTextarea` (высота по тексту, 3–8 строк) |
| `number`, `range` | `number` | `type`, `inputmode="numeric"`, `step="any"` | `number`: `NumberField` → `NumberField` (кнопки «−/+» после оживления; с `variant: 'auto'` — `autoWidth`, ширина по числу); `range`: `RangeField` → `Input` и текущее значение рядом |
| `date`, `time`, `datetime-local` | `date` / `time` / `datetime` | `type` | `TextField` → `Input` |
| `select`, `radio` | `select` | — | `SelectField` → `Select` |
| `multiselect` | `multiselect` | `multiple` | `SelectField` → `Select multiple` |
| `checkbox` | `checkbox` | `type="checkbox" value="on"` | `CheckboxField` → `Checkbox` |
| `switch` | `checkbox` | `type="checkbox" role="switch" value="on"` | `SwitchField` → `Switch` |
| `file` | `file` | `type="file"`; `multiple` при `multiple: true` | `FileField` → `FileInput`; значение — `File`, при `multiple` — `File[]`. Правила видят ОДИН файл: список разворачивает движок |
| `fields` | `fields` (вложенный: записи `имя.…`) | — | **не рисуется** (`Field` его пропускает): места расставляет приложение хуком `fieldSet` (см. «Набор полей от пользователя») |

`otp` и `switch` — не новые типы значения, а представления существующих: код — это
строка (длину и цифры задают правила `v.maxLength(6)`, `v.pattern({ source: '\\d{6}' })`,
они же уходят в `maxlength`/`pattern`), переключатель — флажок с ролью `switch`.

```ts
invite: field.otp({ label: 'Код приглашения', validate: [v.maxLength(6), v.pattern({ source: '\\d{6}' })] }),
digest: field.switch({ label: 'Присылать дайджест на почту' }),
```

Без JS всё перечисленное остаётся обычным элементом формы: кнопки показа пароля,
шага числа, крестик и ячейки кода рисуются только после оживления.

### Вариант показа: `variant`

Одно представление — несколько компонентов. Строка `variant` в описании поля доходит
до `resolve` и до вида поля (`FieldView.variant`); библиотека её не толкует: на
значение, `attrs` и проверки она не влияет. Компонент выбирает приложение.

```ts
// описание формы
password: field.password({ label: 'Пароль', variant: 'strength', validate: [v.minLength(10), v.strength('good')] }),
confirm: field.password({ label: 'Повторите пароль', validate: [v.sameAs('password')] }),   // просто глаз
about: field.textarea({ label: 'О себе', variant: 'auto', validate: [v.maxLength(200)] }), // растёт по тексту
sku: field.text({ label: 'Артикул', variant: 'auto', validate: [v.maxLength(16)] }),       // ширина по тексту
qty: field.number({ label: 'Количество', variant: 'auto', validate: [v.minValue(1)] }),    // ширина по числу

// forms.config.ts
case 'password': return f.variant === 'strength' ? PasswordStrengthField : PasswordField
case 'textarea': return f.variant === 'auto' ? AutoTextareaField : TextareaField
// text/number: тот же компонент, вариант — проп примитива
<Input {...f.attrs} autoWidth={f.variant === 'auto'} />
```

Поля из рантайма (`FieldSpec`) принимают тот же `variant`; не строка — дефект `spec.limit`.

## Каталог валидаторов

Все — в `v` (`validators.ts`). Каждое правило сообщает, к какому виду ограничения
относится; тип значения решает, станет ли вид атрибутом. «Атрибут» — что уходит
в разметку и работает **без скрипта**.

| Правило | Код ошибки | Атрибут | Примечание |
|---|---|---|---|
| `v.required()` | `required` | `required` | пустая строка/`null`/`false`/`[]` — пустота |
| `v.email('html5' \| 'strict')` | `email` | `pattern` (только html5) | `html5` — умолчание и семантика `<input type="email">`; `strict` строже браузера и атрибута не даёт |
| `v.url()` | `url` | — | разбор `new URL` точнее шаблона |
| `v.pattern({ source })` | `pattern` | `pattern` | именованные шаблоны — через реестр |
| `v.minLength(n)` / `v.maxLength(n)` | `minLength`/`maxLength` | `minlength`/`maxlength` | длина строки |
| `v.minValue(n, excl?)` / `v.maxValue(n, excl?)` | `minValue`/`maxValue` | `min`/`max` | величина: число, дата, время; исключающая граница не проецируется |
| `v.minDate(s)` / `v.maxDate(s)` | `minDate`/`maxDate` | `min`/`max` | ISO `ГГГГ-ММ-ДД` |
| `v.minCount(n)` / `v.maxCount(n)` | `minCount`/`maxCount` | — | количество выбранных; нативного атрибута нет |
| `v.integer()` | `integer` | `step=1` | |
| `v.step(n, unit?)` | `step` | `step` | единица важна: у даты — день |
| `v.oneOf(values)` | `oneOf` | — | список сам и есть ограничение |
| `v.accept(types)` | `accept` | `accept` | MIME, `type/*` или расширение — по правилам атрибута; при `multiple` — каждый файл. Сверяется ЗАЯВЛЕННЫЙ клиентом тип, содержимое не проверяется |
| `v.maxSize(bytes)` | `maxSize` | — | нативного атрибута нет; при `multiple` — предел на каждый файл. Число берётся как объявлено: бюджет формы его не сужает — общий вес ловит `form.budget` (ниже) |
| `v.strength(level, o?)` | `strength` | `minlength` (граница уровня) | оценка в битах, не шаблон; заменяемая через `o.score` |
| `v.sameAs(field)` | `sameAs` | — | браузер не умеет сравнивать поля — проверяет сервер |
| `v.notAbove(field)` | `notAbove` | — | не больше значения другого поля: нижняя граница диапазона («от» ≤ «до»). Пустое с любой стороны — не ошибка. Числа — как числа, строки (ISO-даты, время) — по порядку. Параметры: `field`, `other` (значение соседа) |
| `v.notBelow(field)` | `notBelow` | — | не меньше значения другого поля: верхняя граница диапазона. Остальное — как у `notAbove` |
| `v.noOverlap(field)` | `noOverlap` | — | у двух списков нет общих значений («все из» и «кроме»). Параметры: `field`, `values` (общие значения), `count` |
| `check(name)` | код проверки | — | асинхронная, см. [раздел](#асинхронные-проверки) |

### Бюджет тела и файлов

У формы **один** лимит веса — `budget`. `Limits.budget` на сервере — потолок развёртывания
(env): выше него запрос режет платформа (`413`, часто до нашего кода). Форма
вправе объявить бюджет меньше, но не больше env; действует он на все формы.

```ts
defineForm({ id: 'catalog', budget: 4 * 1024 * 1024, fields: { … } })
```

- `budget = min(объявленный, env)` — больше потолка развёртывания объявить нельзя,
  лишнее молча игнорируется.
- Бюджет файлов = бюджета тела − 1 МиБ резерва на текст (`formLimits` из
  `budget.ts`, константа `FILE_BUDGET_RESERVE`).
- `v.maxSize(n)` — обычный валидатор веса одного файла и с бюджетом формы не
  связан: `n` берётся как объявлено, хоть 1 ГБ, хоть без предела вовсе.
- Файловое поле без `v.maxSize` — законно: тогда отдельный файл ничем не ограничен,
  а форму держит бюджет тела (потолок — `budget` окружения).
- Превышение бюджета — одна **общая** ошибка `form.budget` без пути: библиотеке
  всё равно, кто именно перебрал (файл или текст), она говорит, что лимит превышен.
  С JS её показывает общий блок до отправки, без JS тот же `validateForm` на
  сервере возвращает форму с ошибкой; тело сверх потолка отсекает `bodyLayer`
  (`413 body.too-large`).

Сумма пересчитывается на каждом прогоне из значений — добавление и удаление
файлов меняют свободный вес сами, счётчик состояния не нужен.

Вес считает сама библиотека — `weight.ts`: `multipartWeight` раскладывает тело на
части по алгоритму сериализации WHATWG (границы, `Content-Disposition`, `Content-Type`,
значения UTF-8, файлы по `size`), `formWeight` строит записи из значений через
`encode` типа поля. Файлы не читаются. `boundaryBytesOf` снимает настоящую длину
границы из `new Response(fd).headers` — тело при этом не разбирается. Модуль
внутренний: наружу вес пока не отдаётся.

Правила файлов судят **один** файл: движок сам разворачивает `multiple` и зовёт
правило по каждому файлу (клиент и сервер одинаково), так что обход внутри
правила писать не нужно. Ошибка выходит на каждый плохой файл и несёт `params.name`;
«массив или один» правило тоже не разбирает: разворот — работа движка, а признак
`perItem` живёт у проверки в реестре (`CheckRegistry.perItem`), а не у каждой
ссылки `check(...)` в описании.

Межполевые правила (`sameAs`, `notAbove`, `notBelow`, `noOverlap`) ссылаются на
соседа по имени поля и видят значения всей формы после декодирования. Атрибута
у них нет: проверяют ядро в браузере и сервер одним `evaluate`.

```ts
defineForm({
  id: 'catalog',
  fields: {
    // диапазон: ошибка встанет у той границы, которая нарушила порядок
    'year.min': field.number({ label: 'Год от', validate: [v.notAbove('year.max')] }),
    'year.max': field.number({ label: 'до', validate: [v.notBelow('year.min')] }),
    // одно значение не может быть сразу обязательным и исключённым
    'genres.and': field.multiselect({ label: 'Жанры', options }),
    'genres.not': field.multiselect({
      label: 'Без жанров', options,
      validate: [v.noOverlap('genres.and')],
      messages: { noOverlap: 'Жанр уже выбран в «Жанры»' },   // свой текст поля
    }),
  },
})
```

Фильтры каталога получают эти правила готовыми из схемы источника
(`formParams`, см. `src/lib/paginate/filters/README.md`).

`field.email()` задаёт представление и HTML-тип, но формат значения задаёт
`v.email()`. Это необходимо для fetch-пути с `novalidate`: строки без структуры
`local@domain`, например `fffffffff`, отклоняются общим ядром и на клиенте, и на
сервере.

Тексты ошибок не зашиты в валидаторы: правило отдаёт код и параметры, словарь
(`messages.ts`) превращает их в текст. Подстановка `{min}` — из политики.

Свой текст для одного поля можно задать в трёх местах (F56); побеждает самое
близкое к ошибке:

```ts
defineForm({
  id: 'signup',
  fields: {
    // 3) в валидаторе — только для этого правила
    age: field.number({ validate: [v.minValue(18).message('Вам должно быть {min}')] }),
    // 1) в поле — все ошибки этого поля с таким кодом
    kids: field.number({ validate: [v.minValue(0)], messages: { minValue: 'Детей не меньше {min}' } }),
    rating: field.number({ validate: [v.minValue(1)] }),
  },
  // 2) в словаре формы: «поле:код» — одно поле, просто код — все поля формы
  messages: { 'rating:minValue': 'Оценка от {min}', minValue: 'Не меньше {min}' },
})
```

Порядок: валидатор → поле → «поле:код» формы → код формы → приложение
(`createConfig` / `createFormHandler`) → пакет → код как текст. Именованная
ссылка реестра несёт текст так же: `{ name: 'minValue', arg: 18, message: '…' }`;
асинхронная — `check('email-taken').message('…')`. Сервер и браузер считают
текст одним путём.

## Как добавить свой валидатор

Валидатор — обычная функция; описание себя — необязательная добавка:

```ts
import { describe, issue, opaque, registerValidator } from '#lib/form/index.js'

// СИНХРОННОЕ ПРАВИЛО с описанием: атрибут выводится
const inn = () => describe<string>(
  (x) => /^\d{10}|\d{12}$/.test(x) ? null : issue('inn'),
  [{ kind: 'pattern', source: '\\d{10}|\\d{12}' }])

// ПРАВИЛО БЕЗ описания: работает, атрибута нет — и причина названа в отчёте
const luhn = () => describe<string>(
  (x) => luhnOk(x) ? null : issue('luhn'), [opaque('валидатор не описал себя')])

signup.registry.registerValidator('inn', inn)   // сериализуемая ссылка
```

Расширение относится к **виду ограничения**, а не к типу значения: словарь видов
открыт, как и ключи типов. Новое правило либо находит существующий вид
(`pattern`, `minMagnitude`…), либо получает `opaque` — честно, без догадок.

Типы значения расширяются так же:

```ts
// declare module '#lib/form/index.js' { interface FieldValues { rating: number | null } }
signup.registry.registerType({
  kind: 'rating',
  inputs: ['range'],                    // представление, которое тип обслуживает
  multiple: false, empty: null,
  decode: (e) => ({ ok: true, value: e[0] ? Number(e[0]) : null }),
  encode: (v, n, out) => { if (v !== null) out.push([n, String(v)]) },
  constraints: {                        // какие виды тип умеет проецировать
    minMagnitude: (c) => ({ min: c.value }),
    maxMagnitude: (c) => ({ max: c.value }),
  },
  attrs: () => ({ type: 'range' }),
  degradation: { withoutJs: 'ползунок' },
})
```

После регистрации работает и сахар `field.rating({...})`, и проверка применимости
видов в `checkFieldDefinition` — мета-валидация сама заметит, если новый тип
не знает вида, который ему подсунули.

Второй пример в демо — `phone` (`src/components/form/extend.ts`): значение — одна
строка `+79991234567`. `decode` приводит номер, как его пишут люди (`+7 (999) 123-45-67`,
`00…`), к этой строке и отклоняет номер не той длины (код `type.phone`): у страны из
списка `PHONE_COUNTRIES` — длина национальной части обычного и мобильного номера (+7 —
ровно 10 цифр, Беларусь — 9, Армения — 8, Финляндия — 5–10, Германия — 5–13), у кода не из
списка — рамка E.164, 8–15 цифр вместе с кодом. Функция одна (`phoneLengthOk` в
`components/ui/phone-input/phone.ts`, ~1 КБ таблицы вместо ~80 КБ метаданных libphonenumber), поэтому
недобранный номер получает ошибку у поля и в живой проверке, и на сервере. Существование
номера не проверяется.
Как номер набирается, решает компонент приложения: `PhoneField` → примитив `PhoneInput`
(код страны внутри рамки поля, после оживления; без JS — одно поле `type="tel"`).

## Как фильтровать данные

Четыре разных фильтра — не смешивайте их:

1. **Что вообще принимается.** Слой имён (`server.ts`, `namesLayer`) отвергает
   неизвестные поля, дубли одиночных значений и лишние записи — отказом, а не
   молчаливой починкой. «Взять первое значение» скрывало бы ошибку клиента или атаку.

2. **Что возвращается наружу.** `stripSecret` вырезает `secret`-поля (пароль не
   едет в разметку) и файлы: `Result.values` всегда без секретов и без `File` —
   ответ сериализуется (JSON, данные экшена), а поле файла значение из разметки не
   принимает; после отказа файл выбирают заново.

3. **Что показывается.** Обработчик `onErrors` — преобразование массива
   (см. `errors.ts`). Тексты можно забрать, подсветка останется:

   ```ts
   onErrors: (errors, ctx) => errors.filter((e) => e.code !== 'E123')
   // поле всё равно подсвечено: invalidFrom 'fact' считает по факту ошибки
   ```

4. **Что проверяется.** Действие задаёт объём: `validate: 'partial'` со
   `relax: ['required']` (черновик), `subset: ['email']` (проверить одно поле),
   `validate: 'none'` (операции над набором — добавление строк). Кнопка такого
   действия (`form.intent(id)`) получает `formnovalidate`: без JS браузер иначе
   проверил бы по атрибутам все поля и не пустил бы черновик без пароля.

## Выключение полей по значениям

Поле может гаснуть от значений других полей: `disabledWhen` — список правил, это
данные, поэтому их понимают и браузер, и сервер.

```ts
score: field.text({
  label: 'Оценка',
  disabledWhen: [
    { when: { field: 'status', includes: 'anons' }, reason: 'у анонсов нет оценки' },
    { when: { all: [{ field: 'kind', includes: 'tv' }, { field: 'genres', filled: true }] },
      reason: 'с жанрами при ТВ не фильтруем' },
  ],
})
```

- **Условие** — то же, что у `visibleWhen`, плюс `filled` (поле заполнено) и
  `includes` (список содержит значение, скаляр равен ему; сравнение строковое).
- **С JS** поле гаснет сразу (до отправки), под ним — текст. Гашение — работа
  скрипта: без JS выключенный контрол браузер не отправил бы, и запрос пропал бы молча.
- **Без JS** то же правило проверяет `validateForm`: заполненное выключенное поле
  даёт отказ набора, пустое ничего не нарушает.
- **Текст один** на подсказку под полем и на отказ: код `link.blocked`,
  `«{field}» нельзя использовать вместе с {blockers}: {reason}`. Сработало
  несколько правил — говорят все: виновники без повторов («А», «Б» и «В»),
  причины через «; ».
- **Свой текст.** Для всей формы — словарь формы по коду `link.blocked`
  (`messages: { 'link.blocked': '{field} и {blockers} нельзя использовать в связке' }`);
  для одного правила — `message` с теми же подстановками (код `link.message`).
  `blockers` по умолчанию — подписи полей из условия, `label` — как назвать
  выключенное (по умолчанию подпись поля).
- **Канал `fieldState`** в опциях `bind` перекрывает правила: им оболочка
  передаёт решения, которые не данные формы (гидратация, возможности источника).

## Опции по условию (`Option.when`)

Вариант выбора может зависеть от значений формы: у `Option` — то же
`FieldCondition`, что у `visibleWhen`. Вариант показывается, только пока
условие выполнено; фильтр гейтит свои опции соседним параметром без
перерождения формы при открытии:

```ts
'users.ord': field.select({
  label: 'Порядок',
  options: [
    { value: 'created-desc', label: 'Сначала новые' },
    { value: 'nickname-asc', label: 'По никнейму', when: { field: 'users.nick', equals: '1' } },
  ],
})
```

- **Сброс — часть контракта**: скрытая условием опция не может оставаться
  значением. С JS значение уходит на умолчание поля в том же изменении,
  которым условие выключили (`bind`); на сервере конвейер отправки делает
  coercion к умолчанию до валидации (`coerceOptionGates` в `submit`) —
  не отказ: устаревший или подделанный адрес не вина человека.
- Без JS недостижимо из разметки (опции нет в HTML), достижимо только
  ручной правкой адреса — её и закрывает серверный coercion.

## Неродные поля → родные значения

Преобразование живёт в типе значения: `decode` переводит записи FormData в
типизированное значение, `encode` — обратно. Один и тот же ход обслуживает и
браузер, и сервер.

```ts
// многократные записи select → массив; пустая строка → null; 'on' → true
// всё это — builtins.ts, и всё это можно переопределить своим типом
```

Три случая, когда это нужно чаще всего:

- **свой формат хранения**: `rating` хранится числом, в DOM едет `range`;
- **серверные enum'ы**: `select` с `options` уже декодирует только строки —
  `oneOf` проверяет состав;
- **чужая служба**: её имена полей переводятся в наши **до** обработчика —
  см. [раздел про службы](#как-описывать-чужие-службы).

Кодирование значений в FormData — `encode(values, d)` (`decode.ts`): полезно
в тестах и при предзаполнении из продолжения.

## Как описывать чужие службы

Инструкция описывает только формат службы: как достать код, поле и текст.
Разработчик получает уже наши имена — иначе ему пришлось бы разбирать чужой
формат второй раз.

Инструкция регистрируется методом реестра (`registry.registerInstruction`): общего —
`defaultRegistry` — или своего (`createRegistry()`).

```ts
import { defaultRegistry as registry, type ErrorInstruction } from '#lib/form/index.js'

export const apiInstruction: ErrorInstruction = {
  id: 'external-api',
  parse: ({ status, body }) => body?.errors ?? null,   // null — формат не её
  aliases: { user_email: 'email' },                    // имя службы → наше
  codeAliases: { EMAIL_TAKEN: 'email' },               // код → поле, если поле не названо
  messages: { EMAIL_TAKEN: 'Этот адрес уже занят' },
}
registry.registerInstruction(apiInstruction)
```

Нормализованная ошибка хранит `source` — «увести в канал именно эту службу»
или «не показывать вот этот код» делается без повторного разбора тела.

Ответ службы переводится там, где её вызывают, — в `execute`: `normalizeService`
разбирает тело по переданной инструкции, а `ctx.fail` отдаёт ошибки форме
(инструкция и образцы ответов — `src/routes/(site)/(app)/form/psp.ts`).

```ts
import { normalizeService } from '#lib/form/index.js'
import { apiInstruction } from './instructions'   // инструкция из примера выше

async execute({ values, commit, fail }) {
  const res = await fetch(SERVICE_URL, { method: 'POST', body: JSON.stringify(values) })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    // наши имена полей и тексты; формат не узнан — одна общая ошибка `service.<код>`
    fail(normalizeService({ status: res.status, body, instruction: apiInstruction }))
  }
  commit()
  return { data: await res.json() }
}
```

## Асинхронные проверки

Это оптимизация, а не отдельная возможность: на сервере те же проверки
выполняются всегда, отправку они не блокируют.

```ts
const checks = new CheckRegistry()
checks.register('email-taken', async (value, ctx) =>
  ctx.signal.aborted || !(await isTaken(value)) ? null : issue('unique'))

// в описании — обёртка с настройкой подавления и свой текст кода
email: field.email({ validate: [v.required(), v.email(),
  check('email-taken', { debounceMs: 400, cacheByValue: true })],
  messages: { unique: 'Этот адрес уже занят' } })
```

Код проверки лучше брать из словаря пакета (`unique`, `required`, …): у него уже
есть текст, а свой текст поля — в `messages` поля. Свой код (`issue('email.taken')`)
без текста в словаре формы или приложения показывается как есть.

Проверка может вернуть **несколько** ошибок — список `Issue[]`: так правило судит
каждый файл значения (одна строка на плохой файл). Пустой ответ и `null` — «чисто».

В браузере `AsyncRunner` даёт дебаунс, отмену предыдущей проверки того же поля
и кэш по значению. Результат async-проверки заменяет прежние async-ошибки этого
поля целиком: синхронные ошибки `email`, `minLength`, `required` и другие
остаются в состоянии. Признак «идёт проверка» — `FieldView.checking` и
`FormState.checking`.

## Перехват поля: клиентская подготовка значения

Иногда значение поля нельзя отправить как есть: его надо подготовить на
клиенте (например, получить из ответа сервиса токен), а подготовка асинхронна
и может упасть. Для этого у компонента `Field` (кит полей) есть callback
`takeover` — объявляется у конкретного поля прямо в разметке:

```svelte
<Field of={bound.f.code} takeover={(f) => exchangeCode(f)} />
```

Сжатие картинок перехватом **не** делается: это возможность примитива
(`FileInput`/`FileAttachment` с опцией `photoConvert`), см. `#components/ui`.

Callback вызывается один раз после оживления и получает живую ручку
поля `f`: тот же набор, что у `FieldView` (`f.value`, `f.errors`,
`f.attrs`, запись — `f.onInput`), но чтение всегда текущее. Новых
функций нет — добавляются ровно два записываемых свойства:

- `f.error = { code, params? }` — ошибка операции поля: закреплена за
  текущим значением носителя (pins), видна до смены значения,
  собственная проверка поля сильнее, блокирует клиентскую отправку
  полных действий. Сервер её не воспроизводит и не обязан: без JS он
  готовит значение сам. `f.error = undefined` — снять.
- `f.pending = promise` — пока задан, отправка ждёт завершения и
  перечитывает `FormData` из DOM: носитель за это время мог получить
  итоговое значение.

Значение перехватчик пишет парой: готовое значение — в именованный
носитель из `f.attrs` (файл — `new File(...)` через `DataTransfer` в
carrier) и `f.onInput(...)`. Внутренние инпуты перехватчика имени не
имеют и существуют только после оживления: до оживления и без JS поле
штатное, описание формы функций не несёт — сервер перехвата не видит,
проверки и значения на обеих сторонах одни и те же.

Видимый компонент callback может заменить возвратом
`{ view, base, dispose? }`: `Field` включает замену, только если
`base` — ровно тот примитив, что resolve дал этому полю (иначе
штатный компонент и dev-предупреждение). Заменяющий компонент
получает ту же ручку пропом `f`; `instead` в разметке сильнее
замены. `dispose` вызывается при размонтировании поля.

Присваивать `f.error`/`f.pending` вне перехватчика и кита полей
запрещает гард (`tooling/layer-guard.mjs`): ошибка операции — не
способ показать произвольный текст у поля в обход валидации описания.

## Поля из рантайма

Спецификация полностью сериализуема: валидаторы — имена из реестра, функции
запрещены на уровне типа. Поле из рантайма не исполняет чужой код.

```ts
import { compileFieldSpec } from '#lib/form/index.js'

const r = compileFieldSpec({
  name: 'extra1', input: 'tel', label: 'Телефон', required: true,
  rules: [{ rule: 'pattern', arg: 'e164' }],      // именованный шаблон из реестра
})
// r.ok → r.field: дескриптор `u_extra1` со всеми атрибутами; ошибки — r.defects
```

Обычно так компилирует `defineForm({ from })` — список сохранённых полей становится
формой (см. «Набор полей от пользователя»). Набор полей не приходит от клиента: сервер
поднимает описание сам (`source: { resolve, revision }` у `createFormHandler`, `source.ts`)
по идентификатору и версии из конверта. Протокол устаревания (`checkStale`) сверяет
ревизию и состав полей страницы с серверными и переносит значения по именам.

## Набор полей от пользователя

Пользователь собирает поля сам (коллекция: «описание», «ссылка»…) и выбирает им
правила. Для формы это **одно поле** рядом с `text`, `number`, `email`: `field.fields`.
В нём разработчик описывает, из чего собирать: каталог видов и схему валидаторов с
пределами аргументов.

```ts
export const collection = defineForm({ id: 'collection', fields: {
  title: field.text({ label: 'Название', validate: [v.required(), v.maxLength(120)] }),
  props: field.fields({ label: 'Поля записи', max: 20,          // предел самого набора
    rules: {                                                  // схема валидаторов
      required: {},
      maxLength: { min: 1, max: 5000, default: 500 },
      minValue: { min: -1_000_000, max: 1_000_000 },
    },
    kinds: {                                                  // каталог видов
      textarea: { label: 'Текст', input: 'textarea', extra: ['required', 'maxLength'] },
      email: { label: 'Почта', input: 'email', locked: ['email'], extra: ['required', 'maxLength'], rules: { maxLength: { max: 254 } } },
      tel: { label: 'Телефон', input: 'tel', locked: [{ rule: 'pattern', arg: 'e164' }], extra: ['required'] },
      number: { label: 'Число', input: 'number', extra: ['required', 'minValue'] },
    } }),
} })
```

Форма это поле **сама не рисует**: `<Field of={form.f.props} />` ничего не выводит. Где
цикл по местам, где «+ поле», какие обёртки и классы — решает разметка приложения.
Хук `fieldSet` (`#lib/form/svelte`) даёт места с готовыми видами контролов (их рисует
обычный `Field` или свой компонент) и пропсы кнопок:

```svelte
<script lang="ts">
  import { fieldSet } from '#lib/form/svelte/index.js'
  const set = fieldSet(form, 'props', {
    labels: { label: 'Название поля', kind: 'Вид', rules: 'Правила' },
    rule: (r) => RULE_LABEL[r] ?? r,          // подписи правил — тексты приложения
  })
</script>

{#each set.errors as e (e.id)}<p role="alert">{e.message}</p>{/each}   <!-- предел набора -->
{#each set.rows as row (row.key)}
  <div class="card">
    <Field of={row.label} /> <Field of={row.kind} /> <Field of={row.rules} />
    {#each row.args as a (a.name)}<Field of={a} />{/each}           <!-- числа выбранных правил -->
    <Button {...set.removeProps(row)}>Удалить</Button>
  </div>
{/each}
<Button {...set.addProps()}>+ поле</Button>                         <!-- disabled на пределе -->
```

| Часть | Что |
|---|---|
| `rows` | места по порядку: `key`, `preset`, виды `label`/`kind`/`rules`, `args`, `locked` (правила вида), `errors` места, `filled` |
| `errors`, `full` | ошибки набора целиком; предел `max` достигнут |
| `addProps()`, `removeProps(row)` | пропсы кнопок; `add()`, `remove(key)` — то же из своего кода |

Пустого места заранее нет: место появляется по «+ поле». Ключ нового места случайный
(`f` + 6 знаков, `fieldSetKey`): удалённое поле не отдаёт свой ключ новому, и значения
записей под старым ключом не приписываются чужому полю.

**Без JavaScript** кнопки — отправка формы с намерением `fields-add:props` и
`fields-remove:props.<ключ>`. Эти действия форма объявляет сама, когда в ней есть
`field.fields`. Сервер ничего не выполняет и не проверяет: возвращает `ok: true`,
`outcome: 'not-applied'` (статус 200) и в `values.props` — места как есть (и пустые) плюс
новое или без удалённого. Страница сеет такой ответ в форму так же, как отказ. Механизм
один для обоих режимов: кнопки всегда `type="submit"`, без скрипта — обычная отправка с
перезагрузкой, с скриптом её перехватывает усиление формы (без перезагрузки), шов —
адаптер транспорта: фреймворк без своего механизма способен написать свой. Без JS Enter
в поле нажимает **первую** кнопку отправки формы — ставьте первой свою кнопку сохранения
(на `/fields` — скрытая копия `<button type="submit" hidden>` в начале формы), иначе Enter
нажмёт «Удалить» первого места.

Значение поля — список `FieldSetItem`, уже приведённый к пределам на обеих сторонах:
`execute` получает проверенный список, его и хранят. Элемент самодостаточен:
`{ name, preset, input, label, rules }`, правила вида — внутри `rules`.

| Правило | Как |
|---|---|
| `locked` | правила вида: всегда есть у поля, снять или заменить нельзя; выбор только добавляет. Хук показывает их **внутри списка правил** выбранным выключенным пунктом (подпись — из `rule`, тексты приложения): это картинка того, что каталог добавит сам, в отправке такого пункта нет |
| `extra` | что пользователь может добавить; правило не из списка — ошибка `kit.rule-not-allowed` |
| `min`/`max` | значение вне пределов заменяется ближайшей границей; число может быть отрицательным |
| `default` | правило, которого пользователь не выбрал, добавляется с этим значением; выбранное без значения получает его же |
| пределы вида | только сужают пределы схемы; значение по умолчанию сужается вместе с ними |
| «нет предела» | отсутствие ключа, `undefined`, `null`, `false`, `''` — своих чисел у библиотеки нет |
| неверная настройка | правило не из реестра, `min > max`, предел не число — исключение при объявлении |

Список «Правила» до оживления показывает **все правила схемы** (`FieldKit.rules`) — браузер
ещё не знает вид поля; после оживления выбор сужается до правил вида. Смена вида правила
**не сбрасывает** — их правит пользователь. Допустимость проверяет схема: правило, которого
нет у вида, отклоняется ошибкой `kit.rule-not-allowed` у «Правил» места (и без JS тоже).

Записи в разметке — по местам: `props.f7k2m9q.label`, `….kind`, `….rules`
(повторяется), `….max_length` (значение правила, имя в snake_case);
`fieldSetName(name, slot, part)`. Место без названия не считается, порядок — порядок
появления в форме. Слой имён пропускает ключи `props.…` (тип объявлен `nested`), лишний
уровень и повтор одиночной записи — ошибка разбора. Ошибки лежат на подпутях:
`props.<ключ>.max_length`, `….rules`, `….kind`; предел набора — на `props`.
При отказе набранное возвращается в разметку — без JS ничего не теряется.

Сохранённый набор снова становится формой — как есть или с полями из кода:

```ts
const record = defineForm({ id: 'record', from: saved,       // поля набора: u_<ключ>…
  fields: { title: field.text({ label: 'Название' }), image: field.file({ label: 'Файл' }) } })
```

И здесь поля набора расставляет разметка: `form.from()` отдаёт их по порядку вместе с
исходным полем схемы — по `item.preset` можно взять свой компонент.

```svelte
{#each form.from() as { item, f } (f.name)}
  {#if item.preset === 'email'}<MyEmail of={f} />{:else}<Field of={f} />{/if}
{/each}
```

Поля из `from` идут первыми, с префиксом `u_`, и не считаются «новыми» — `required`
действует сразу. Каталог для этого не нужен: правила уже в значении. Сервер строит
форму записи из сохранённого (`source: { resolve: async () => defineForm({ from: … }) }`),
а не из тела запроса. Проверка идёт в момент записи: когда схема стала строже, старые
записи не перепроверяются, при правке обязаны пройти новые правила.

Запись хранит значения **по ключу** (`{ title, image, values: { f7k2m9q: '…' } }`), подписи
в ней нет: показ берёт подпись из текущего набора, ключа в наборе нет — значение не
выводится. Ключи форма по умолчанию не сверяет с записями. Если новый ключ или смена вида
должны быть запрещены, пока у записей есть значение под ключом, — это проверка приложения в
`execute`, например в PG (jsonb):

```ts
execute: async (c) => {
  for (const it of c.values.props) {                      // новые и сменившие вид ключи
    if (!changed(it)) continue
    const { rows } = await sql`SELECT EXISTS (SELECT 1 FROM records
      WHERE collection_id = ${id} AND data ? ${it.name}) AS used`   // и удалённые мягко
    if (rows[0].used) c.fail([{ path: ['props', it.name, 'kind'], code: 'key.used', message: 'Ключ уже занят записями' }])
  }
  …
}
```

Удалённый ключ так же нельзя занять, пока записи его держат; случайные ключи делают
совпадение почти невозможным. Под `?` — GIN-индекс на `data`; все ключи записей —
`jsonb_object_keys(data)`. Текст ошибки выбирает приложение.

Тексты для человека (подписи видов — в `kinds[…].label`, правил — в компоненте) выбирает
приложение. Замены при сохранении (что было обрезано до предела) разбор не сообщает:
значение приходит уже приведённым. Живой пример — страница `/fields`
(`routes/(site)/(app)/fields/`): форма набора, форма записи на нём и пример записи;
набор и запись лежат в `#lib/cache`. Разметка набора — `SchemaBuilder.svelte`, полей
записи — `SchemaFields.svelte` (`src/components/fields/`), маршрут — `src/routes/(site)/(app)/fields/`.

## Внешние схемы

Схема — источник **ошибок**, но не источник атрибутов: вывод разметки из
чужого словаря правил не входит в контракт. Поддержан контракт Standard Schema
(`~standard`): zod, valibot, arktype и другие.

```ts
import { z } from 'zod'
const handler = createFormHandler({
  description: signup,
  schema: z.object({ age: z.number().min(18, 'Только совершеннолетним') }),
  // ...
})
```

Схема гоняется после синхронных правил и только если они прошли: межполевое
над мусором бессмысленно. Issues склеиваются в `path` обычным способом.

Если в issue есть строковый `code` (и, может быть, `params`/`template`), ошибка получает этот
код, и текст берётся из словарей так же, как у своих правил: `template` → «поле:код» →
код → готовый `message` issue. Без `code` — код `schema` и текст issue как есть.

### Ошибки из бизнес-действия: `ctx.fail(issues)`

`ctx.fail` в `execute` принимает не только `FormError`, но и issues в том же формате. Так
приходят ошибки `lib/db` (`failureIssues`) — без импорта друг друга:

```ts
execute: async (ctx) => {
  try { await locals.db.resource(users).insert(locals.dbCtx, ctx.values) }
  catch (e) { const issues = failureIssues(e); if (issues) ctx.fail(issues); throw e }
  ctx.commit()
}
```

`{ path: ['email'], code: 'unique', message: '…' }` становится ошибкой поля `email` с текстом
«Это значение уже занято» (код `unique` есть в словаре пакета). Свой текст у поля формы —
`field.email({ messages: { unique: 'Этот email уже зарегистрирован' } })`. Свой текст модели
(`template`) сильнее словарей. Issue без `path` — общая ошибка формы.

Все коды ошибок БД, когда ошибка привязывается к полю и откуда берётся текст — в README
`lib/db`, §4 «Ошибки по полям и свои тексты».

**Сколько живёт ошибка сервера у поля.** В живой форме (Svelte-привязка) ошибка поля из
`ctx.fail`, `lib/db` или внешней схемы закреплена за значением, с которым её прислал сервер:
видна, пока значение поля равно отправленному; любая правка скрывает её, возврат к тому
же значению — показывает снова. Сверка — на каждом вводе, уход с поля ничего не меняет
(кнопка под полем не сдвигается в момент клика). Ошибка нескольких полей
(`params.fields`) видна, пока совпадают все. Собственная проверка поля сильнее: если она
сейчас нашла ошибку, показывается она. Общие ошибки формы держатся до следующей отправки.

После обычного POST без JS сравнивать не с чем, кроме разметки: значения снимаются с
полей в момент оживления. Секретное поле сервер не возвращает — оно пустое, и ошибка
видна, пока оно пустое. Без JS ничего не исчезает: ошибка стоит до следующей отправки.

## Правила из чужой схемы, `pick` и `prepare`

**Поле с правилами из чужой схемы.** Генератор параметров (`formParams` схемы фильтров,
`formParams` модели БД из `#hooks/db-form.js` (переходник приложения в `src/hooks`)) отдаёт полю `validate`; генератор модели БД, если
перевёл правила схемы целиком, — ещё и `rulesFrom: { schema, rules }`: сам объект схемы и
выданные из неё валидаторы.
Руками `rulesFrom` не пишут: он приходит развёрткой.

```ts
const post = formParams(posts)                    // #hooks/db-form.js
title: field.text({ label: 'Заголовок', ...post.title }),
title: field.text({ label: 'Заголовок', validate: [...post.title.validate, v.email()] }),   // свои — рядом
```

**`pick` — что уходит получателю.** В `execute` рядом с `values`: копия только перечисленных
полей. На ней метка «проверено этой схемой» — неперечисляемое свойство-символ
`Symbol.for('modals-kit.validated-proof.v1')` со значением `{ fields: { поле: { schema, value } } }`;
`values` метки не несут. Метку получает поле, только если всё сходится:

- действие проверяло форму целиком (`validate: 'full'`, без `relax` и `subset` — у черновика метки нет);
- поле видимо — его форма действительно проверила;
- у поля есть `rulesFrom`, и **все** его `rules` остались в `validate` (правила заменили — метки нет).

```ts
async execute({ values, pick, commit }) {
  await db.resource(posts).insert(dbCtx, pick(['title']))   // agree до базы не идёт
  if (values.notify) await subscribe(…)
  commit()
  return {}
}
```

Получатель (`lib/db`) сверяет объект схемы и значение и не повторяет правила; иначе проверяет
сам. В JSON, `Object.keys` и копию метка не попадает. Имя не из формы — исключение (`pick` —
код приложения, опечатка видна сразу). `stampProof`/`readProof`/`VALIDATED_PROOF`
экспортируются для своих получателей; договорённость с `lib/db` держат тесты с обеих сторон.

**`prepare` — очистка на сервере до правил.** Опция `createFormHandler`: функция на поле,
`(value, values) => новое` или `{ value, note }`. Выполняется только на сервере (списки слов не
уходят в браузер), после разбора запроса и **до** правил формы — правила проверяют уже
очищенное значение, и метка `pick` честная: проверено ровно то, что уходит получателю.

```ts
createFormHandler({
  description: dbCreate,
  prepare: {
    title: (text) => {
      const clean = stripLinks(String(text))
      return clean === text ? clean : { value: clean, note: 'Текст изменён: удалены ссылки' }
    },
  },
  execute: …,
})
```

- **Ошибка после очистки** (очищенное стало короче минимума или длиннее максимума) — обычная
  ошибка поля, а в поле возвращается **очищенное** значение (`Result.values`): человек правит то,
  что будет сохранено, и при следующей отправке фильтру нечего менять.
- **`note`** уходит в `Result.notes` (`{ поле: текст }`) и в вид поля — `f.note` и `f.noteProps()`
  (id узла входит в `aria-describedby`). Текст задаёт приложение; живёт до следующей отправки.
- **Синхронно.** Внешняя модерация — в `checks` или `execute`.
- Поле не из формы или не функция — исключение при создании обработчика.
- Проверка в браузере идёт по исходному тексту: очистки там нет.

## Политика: пределы, имена, конверт

Всё, от чего зависит «примет ли библиотека чужой код и чужие данные», собрано
в `policy.ts` и переопределяется:

```ts
const policy = policyWith({
  envelopeKeys: { id: 'form', rev: 'rev' /* … */ },  // имена ключей конверта
  names: { pattern: /^[a-z][a-z0-9_]{0,63}$/, maxSegments: 6 },
  limits: { fields: 256 },
  interpolate: (t, p) => t.replace(/:(\w+)/g, (_, k) => String(p[k])), // :min вместо {min}
})
defineForm({ id: 'signup', policy, fields: { /* … */ } })
```

Именованные шаблоны (`registerPattern`) — тот же принцип: белый список
расширяется регистрацией, а не правкой ядра.

## Исходы отправки

Четыре значения, и ни одного «наверное» (`result.ts`):

| Исход | Что значит | Что делать |
|---|---|---|
| `not-applied` | проверка не прошла или отказ слоя | показать ошибки |
| `committed` | действие зафиксировано `commit()` | успех |
| `unknown` | сеть упала в полёте, `execute` упал или не позвал `commit()` | **не** отправлять повторно; адаптер сообщает в `onError` (`outcome-unknown`) |
| `queued` | принято, результат позже | опрос (`pollUntilDone`) или ссылка `statusUrl` без скрипта |

Очередь: `execute` зовёт `commit()` (заявка записана) и возвращает `queued` с адресами.
Ответ — `202`, исход `queued`, адреса — в `Result.data` (`queuedData(result)`); без
`pollUrl`/`statusUrl` это ошибка разработки (`assertQueuedProtocol`). Опрашивает
страница: `pollUntilDone` берёт паузу из ответа сервера и возвращает итоговый `Result`,
его поднимает `form.lift(итог)`. Связка после `queued`, как и после `committed`/`unknown`,
берёт новый `submissionId`.

```ts
// сервер
async execute({ values, commit }) {
  const job = await enqueue(values)          // ваша очередь
  commit()
  return { queued: { pollUrl: `/jobs/${job}.json`, statusUrl: `/jobs/${job}`, etaMs: 5000 } }
}
// страница: опрос, пока исход queued; ответ опроса — { done, retryAfterMs } или { done, result }
const q = form.state.result && queuedData(form.state.result)
if (q) pollUntilDone(q, (url, signal) => fetch(url, { signal }).then((r) => r.json()), { signal })
  .then((final) => final && form.lift(final))
```

Пример — `/form`, «Ответ сервера» → «в очереди» (`src/routes/(site)/(app)/form/queue.server.ts`, `jobStatus`).

Переход после успеха: `execute` возвращает `{ redirect: '/путь' }`, библиотека
пропускает только адрес своего сайта (`Result.redirect`). Переходит маршрут или
страница — библиотека сама не уводит:

```ts
// +page.server.ts — без скрипта
if (result.ok && result.redirect) redirect(303, result.redirect)
// +page.svelte — после перехвата
$effect(() => { if (form.state.result?.redirect) goto(form.state.result.redirect) })
```

Идемпотентность: повтор одной отправки с тем же `submissionId` возвращает
прежний результат, обработчик не вызывается. После окончательного исхода
`committed` или `unknown` адаптер создаёт новый `submissionId`, поэтому следующая
осмысленная отправка является новой операцией. Хранилище — интерфейс
`IdempotencyStore`, в памяти — `MemoryIdempotencyStore`.

`get`/`put` защищают только от последовательного повтора. От параллельного
(двойной клик, повтор прокси, пока первый запрос выполняется) — необязательная
пара `reserve`/`release`: `reserve` обязана атомарно занять ключ (в БД —
`INSERT … ON CONFLICT DO NOTHING`, в Redis — `SET NX PX`). Занятый ключ даёт
дублю `409 submission.in-flight` с исходом `not-applied` и тем же
`submissionId`. Бронь снимается только при исходе `not-applied`; при `unknown`
она держится до `IDEMPOTENCY_RESERVE_MS`. `MemoryIdempotencyStore` реализует
бронь и вычищает просроченные записи — он годится для одного процесса.

`storeIdempotency(store)` строит то же хранилище поверх любого объекта с
`get`/`set`/`delete` и атомарным `add` (`IdempotencyKv`): например, области
`memoryStore` из `#lib/cache` или сетевого хранилища с тем же контрактом. Бронь —
это `add`, поэтому у общего для инстансов хранилища и защита от дубля общая.
Хранилище без `add` отвергается сразу при подключении: эмуляция через
`get` + `set` пропустила бы параллельный дубль. У хранилища с потолком запись
может уйти раньше срока, поэтому потолок берут с запасом на отправки за сутки.

```ts
import { storeIdempotency } from '#lib/form/server.js'
import { localStore } from '#server/cache.server.js'

const idempotency = storeIdempotency(localStore.scope('signup:idempotency', { max: 10_000 }))
```

Частота: `windowThrottle({ limit, windowMs, key, store? })` отказывает до чтения тела.
Окно скользящее: считаются попадания за последние `windowMs` от каждого запроса,
поэтому на стыке окон всплеска «вдвое больше лимита» нет (у фиксированного окна
на счётчике он есть).
`key` обязателен — умолчания «по адресу клиента» нет, потому что сырой
`x-forwarded-for` задаёт сам клиент. Ключ — заголовок, который перезаписывает
ваш прокси, сессия или пользователь.

Где живут окна:

| `store` | Память | Когда |
|---|---|---|
| не задан | карта процесса; окна без попаданий удаляются раз за `windowMs`, потолка нет | один процесс, небольшой поток адресов |
| `ThrottleKv` — любой объект с `get`/`set` со сроком | срок записи — до выхода младшей метки, лишнее вытесняет потолок хранилища | нужен потолок памяти; например область `localStore` |

Записи — массивы меток (`number[]`), каждое попадание пишет новый массив.
С синхронным хранилищем (память процесса) ответ синхронный и окно точное. С
сетевым чтение и запись — две операции: два одновременных запроса могут пройти
оба, и лимит становится примерным.
Контекст запроса фреймворка маршрут передаёт приёмнику третьим аргументом, и он
приходит в ключ вторым — в SvelteKit так берётся адрес клиента:

```ts
const throttle = windowThrottle<RequestEvent>({
  limit: 30, windowMs: 60_000,
  // без event — ошибка, а не общее окно на всех
  key: (_request, event) => event!.getClientAddress(),
  // необязательно: окна в области с потолком (lib/cache), а не в своей карте
  store: localStore.scope('signup:throttle', { max: 10_000 }),
})
// маршрут: handle(event.request, 'action', event)
```

`SubmitMachine.acquire()` реализует политики параллелизма. В режиме `queue`
ожидающие отправки получают слот по завершении текущей и выполняют собственный
`runSubmit`; очередь не требует повторного клика.

Без JavaScript набранное переживает круг через результат экшена: страница отдаёт
его в `bind(…, { continuation })` (или `form.lift(result)`), значения возвращаются в
поля, ошибки — к своим полям.

## Отправка как задача: `formTask`

Чтобы кнопка показала спиннер, а отправка попала в глобальный лоадер, адаптер
Svelte переводит состояние формы в общий формат задачи `#lib/task`
(`svelte/task.ts`). Тип повторён структурно: библиотека форм ни от чего не
зависит, а результат подходит везде, где ждут `TaskState`.

```svelte
<script lang="ts">
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import { Button } from '#components/ui/index.js'
  const form = bind(forms, signup)
</script>

<Form {form}>
  <Button type="submit" task={formTask(form.state)}>Добавить</Button>
  <!-- две кнопки: спиннер только у нажатой -->
  <Button type="submit" {...form.intent('save-draft')} task={formTask(form.state, 'save-draft')}>Черновик</Button>
</Form>
```

- `pending` — пока идёт отправка (с `intent` — только этим действием);
- подписей нет: слова выбирает UI;
- ошибка отправки — не ошибка кнопки (её показывают поля и сводка), после
  ответа задача всегда `idle`;
- ход отправки, если транспорт его сообщает (`TransportRequest.report`), лежит в
  `FormState.progress` и, когда он уже в формате задачи, уходит в `formTask` как есть —
  процент на кнопке и подпись полосы. Ядро значение не толкует; устаревшая отправка
  его не пишет. Пример транспорта — `#hooks/component-form/transport.ts`
  (`fetchWithTask` из `#lib/fetch`: сервер присылает ход строками ответа).

## Проверки и бюджеты

Библиотеку охраняют два вида автоматических проверок:

- **Модульные тесты ядра.** Описание, правила, проверка, показ, конверт, поля из
  данных, набор полей от пользователя — поведение ядра, одинаковое для всех движков.
- **Стражи.** Вес библиотеки, чистота импортов, границы слоёв: ядро не импортирует
  пакетов, пакет движка разрешён только в своей зоне, адаптер не растёт быстрее
  ядра.

Бюджеты веса: raw — «вес чтения» (сколько байтов обязан прочитать тот, кто правит
библиотеку), gzip — «вес доставки» (прокси того, что уедет в браузер), адаптеры
движков — отдельной строкой каждый. Рост бюджета — осознанный: отдельным
изменением с причиной; молчаливые +10% невозможны. Текущие пределы:
361.3 КБ raw / 103.5 КБ gzip / адаптер svelte 20.4 КБ (`BUDGETS` в `tooling/form-size.mjs`;
факт — 355.5 КБ raw / 102.4 КБ gzip, адаптер 19.0 КБ).
