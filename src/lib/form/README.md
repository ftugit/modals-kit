# form — формы без HTML-элементов

Изоморфная библиотека форм: **описание — данные, разметка — приложение, ядро — один и тот же
код в браузере и на сервере**. Библиотека не создаёт ни одного DOM-элемента: она считает
атрибуты, проверяет значения, принимает запрос и решает, что показывать. Теги расставляет
приложение — поэтому одна и та же форма одинаково работает в Svelte, React и Solid.

```
описание(поля, правила) → связывание(настройка) → наборы пропсов → ваша разметка
```

Готовые адаптеры движков: `svelte/`, `react/`, `solid/` (см. [Адаптеры движков](#адаптеры-движков)).
Ядро покрыто модульными тестами, а вес и чистоту слоёв охраняют автоматические
стражи: бюджет каждого адаптера — отдельной строкой.

## Содержание

- [Быстрый старт](#быстрый-старт)
- [Как это устроено](#как-это-устроено)
- [Как подключить к своему движку](#как-подключить-к-своему-движку)
- [Адаптеры движков](#адаптеры-движков)
- [Как создать свой хук](#как-создать-свой-хук)
- [Фронтенд и бэкенд одновременно](#фронтенд-и-бэкенд-одновременно)
- [Каталог валидаторов](#каталог-валидаторов)
- [Как добавить свой валидатор](#как-добавить-свой-валидатор)
- [Как фильтровать данные](#как-фильтровать-данные)
- [Неродные поля → родные значения](#неродные-поля--родные-значения)
- [Как описывать чужие службы](#как-описывать-чужие-службы)
- [Асинхронные проверки](#асинхронные-проверки)
- [Повторяемые группы](#повторяемые-группы)
- [Поля из рантайма](#поля-из-рантайма)
- [Внешние схемы](#внешние-схемы)
- [Политика: пределы, имена, конверт](#политика-пределы-имена-конверт)
- [Исходы отправки](#исходы-отправки)
- [Проверки и бюджеты](#проверки-и-бюджеты)

---

## Быстрый старт

Описание — изоморфный модуль: его импортируют и страница, и сервер. Ноль UI, ноль HTTP,
ноль Svelte — чистый TypeScript.

```ts
// signup.ts — описание: изоморфный модуль, его импортируют обе стороны
import { defineForm, field, v } from '$lib/form'

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
import { createConfig } from '$lib/form/svelte'
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
  import { bind } from '$lib/form/svelte'
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
| динамика | `editor.ts`, `spec.ts`, `source.ts` | операции над набором полей, рантайм, устаревание |
| обвязки | `svelte/`, `react/`, `solid/` | единственные места, где ядро встречается с фреймворком |

Три правила, которые не нарушаются:

1. **Ядро не знает фреймворка.** В файлах ядра нет ни одного импорта вне
   относительных путей; зоны адаптеров (`svelte/`, `react/`, `solid/`) — отдельные
   слои, и пакет движка разрешён только в своей зоне. Страж проверяет это на
   каждом прогоне.
2. **Граница «разметка — данные».** Библиотека не создаёт элементов и не знает,
   как выглядит поле. Она даёт готовый набор пропсов.
3. **Один код-путь.** Перехваченная отправка в браузере и нативный POST на сервере
   исполняют один и тот же `evaluate()`. Расхождение путей невозможно по построению.

## Как подключить к своему движку

Ядро приезжает исходниками и не зависит от сборщика. Схема для любого фреймворка:

1. **Алиас на исходники.** Никаких пакетов — прямой импорт модулей ядра:

   ```ts
   // vite.config.ts вашего приложения
   // form — путь к исходникам библиотеки
   resolve: { alias: [
     { find: /^@form$/, replacement: `${form}/index.ts` },
     // суффиксы — зоны библиотеки: адаптеры движков и серверная половина
     { find: /^@form\/(.+)$/, replacement: `${form}/$1` },
   ] }
   ```

   В `index.ts` нет ни одного фреймворка: точка входа ядра чиста. Суффиксные
   алиасы открывают зоны библиотеки: `@form/svelte`, `@form/react`,
   `@form/solid`, `@form/server`.

2. **Реализовать транспорт** — единственное место, где ядро касается сети:

   ```ts
   import type { Transport } from '@form'

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
   | операции над набором | `applyOps`, `reconcile` (`editor.ts`) |
   | конверт | `buildEnvelope` (`envelope.ts`) |

4. **Взять готовый слой реактивности** — для Svelte, React и Solid он уже написан:
   см. [Адаптеры движков](#адаптеры-движков). Для другого движка — следующий раздел;
   эталонная реализация: [`svelte/bind.svelte.ts`](./svelte/bind.svelte.ts)
   (~400 строк, половина — комментарии).

## Адаптеры движков

Три зоны — `svelte/`, `react/`, `solid/` — повторяют один и тот же контракт.
Настройка проекта один раз (`createConfig` → `BoundConfig`), связка одной
строкой, дальше — наборы пропсов для вашей разметки:

| | Svelte | React | Solid |
|---|---|---|---|
| импорт | `@form/svelte` | `@form/react` | `@form/solid` |
| связка | `bind(forms, signup, opts)` | `useForm(forms, signup, opts)` | `createForm(forms, signup, opts)` |
| состояние | руны | `useSyncExternalStore` | `createSignal` + `batch` |
| поле | `form.f.email` | `form.f.email` | `form.f.email` |
| `labelProps` | `for` | `htmlFor` | `for` |
| атрибуты | HTML-имена (`minlength`) | camelCase-пропсы (`minLength`) | HTML-имена (`minlength`) |
| выбор компонента поля | `resolve` в настройке | приложение по `f.input` | приложение по `f.input` |

Настройка `createConfig` одинакова у всех трёх (`transport`, `live`, `parallel`,
`onErrors`, `invalidFrom`, `ui`); у Svelte-адаптера есть ещё `resolve` —
«представление → компонент». React и Solid не навязывают компоненты: приложение
само выбирает их по `f.input` из `FieldView`.

### React

```ts
// forms.config.ts — настройка проекта: один раз на приложение
import { createConfig } from '@form/react'
import { fetchTransport } from './transport'

export const forms = createConfig({
  transport: fetchTransport,
  live: 'after-touched',
})
```

```tsx
// SignupForm.tsx — разметку пишет приложение
import { useForm } from '@form/react'
import { signup } from './signup'

export function SignupForm() {
  const form = useForm(forms, signup)
  const email = form.f.email

  return (
    <form {...form.formProps()}>
      {form.hidden().map((h) => <input key={h.name} {...h} />)}

      {form.common[0] && <div role="alert">{form.common[0].message}</div>}

      <label {...email.labelProps()}>{email.label}</label>
      <input {...email.attrs}
             onInput={(e) => email.onInput(e.currentTarget.value)}
             onBlur={() => email.setTouched()} />
      {email.errors[0] && <p {...email.errorProps()}>{email.errors[0].message}</p>}

      <button {...form.intent('submit')}>Создать аккаунт</button>
    </form>
  )
}
```

Перевод HTML-имён в camelCase-пропсы (`maxlength` → `maxLength`) — внутри
адаптера: ядро говорит на языке разметки, React — на языке пропсов. Номер
отправки в конверте рождается на каждой стороне свой, поэтому для него
адаптер отдаёт `defaultValue`, а не `value`: React не сверяет
неконтролируемое поле при оживлении, и в DOM остаётся номер сервера.

### Solid

```ts
// forms.config.ts — настройка проекта: один раз на приложение
import { createConfig } from '@form/solid'
import { fetchTransport } from './transport'

export const forms = createConfig({
  transport: fetchTransport,
  live: 'after-touched',
})
```

```tsx
// SignupForm.tsx — разметку пишет приложение
import { createForm } from '@form/solid'
import { signup } from './signup'

export function SignupForm() {
  const form = createForm(forms, signup)

  return (
    <form {...form.formProps()}>
      <For each={form.hidden()}>{(h) => <input {...h} />}</For>

      <label {...form.f.email.labelProps()}>{form.f.email.label}</label>
      <input {...form.f.email.attrs}
             onInput={(e) => form.f.email.onInput(e.currentTarget.value)}
             onBlur={() => form.f.email.setTouched()} />
      <Show when={form.f.email.errors[0]}>
        <p {...form.f.email.errorProps()}>{form.f.email.errors[0].message}</p>
      </Show>

      <button {...form.intent('submit')}>Создать аккаунт</button>
    </form>
  )
}
```

Компонент Solid живёт один раз, поэтому связка создаётся один раз, а настройки
читаются лениво — объект опций с геттерами, а не снимок. Атрибуты остаются
HTML-ными: Solid пишет их в разметку как есть, перекладки имён нет.

## Как создать свой хук

Хук приложения — тонкая обёртка над адаптером, чтобы не повторять настройку на каждой
форме. Библиотека фабрики хуков не поставляет: это право приложения. Ниже — полный
каркас адаптера на React (готовые варианты — [`react/bind.ts`](./react/bind.ts) и
[`solid/bind.ts`](./solid/bind.ts)):

```ts
// form/use-form.ts — адаптер React: useState над FormStore
import { useSyncExternalStore } from 'react'
import {
  FormStore, initialState, SubmitMachine, runSubmit, evaluate,
  applyHandler, split, hasError, invalidFromFor,
  AsyncRunner, buildEnvelope, makeRenderer, ru,
  editor, applyOps, reconcile,
} from '@form'

export function useForm(description, opts) {
  const store = useRef(new FormStore(initialState(description.revision)))
  const machine = useRef(new SubmitMachine(opts.parallel ?? 'block'))
  const runner = useRef(opts.checks ? new AsyncRunner(opts.checks) : null)

  // снимок для рендера: getSnapshot стабилен по ссылке — иначе цикл
  const state = useSyncExternalStore(
    store.current.subscribe, store.current.getSnapshot, store.current.getSnapshot)

  // ... скрытые поля, viewOf(), submit(), apply() — как в svelte/bind.svelte.ts

  return { state, f, formProps, hidden, intent, submit, apply, rows }
}
```

Свои настройки, которые хук обычно выставляет (все — из `FormsConfig` в `config.ts`
зоны адаптера: [`svelte/`](./svelte/config.ts), [`react/`](./react/config.ts),
[`solid/`](./solid/config.ts)):

| Настройка | Тип | Что решает |
|---|---|---|
| `resolve` | функция | «представление → компонент», только в svelte-адаптере. Умолчаний нет: забыли — ошибка конфигурации |
| `transport` | `Transport` | как уезжает перехваченная отправка |
| `live` | `'on-submit' \| 'on-blur' \| 'on-input' \| 'after-touched'` | когда поле перепроверяется |
| `parallel` | `'block' \| 'replace' \| 'queue'` | поведение при двойном клике |
| `onErrors` | `ErrorHandler` | обработчик ошибок проекта |
| `invalidFrom` | `'fact' \| 'shown'` | источник подсветки по умолчанию |
| `ui` | `Partial<UiPolicy>` | идентификаторы, `aria-describedby`, эскалация живой проверки |

Про `ui`-политику: `fieldId`, `describedBy`, `shouldValidate`, `valueAttrs` — четыре
функции, которые раньше были зашиты в сборке пропсов. Подмените их в настройке,
если нужны свои идентификаторы или другое правило перепроверки: настройка принимает
`Partial<UiPolicy>`, а не применяется целиком — умолчания остальных функций живут.

## Фронтенд и бэкенд одновременно

Модуль описания импортируют обе стороны. Сервер не доверяет клиенту ничего:
набор полей, ревизия и правила приходят из кода, а не из запроса.

```ts
// сервер: приём запроса — переставляемые слои
import { createFormHandler, MemoryIdempotencyStore } from '$lib/form/server'
import { signup } from './signup'

const handle = createFormHandler({
  description: signup,
  checks: { /* реестр асинхронных проверок */ },
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

Два пути, один семантический контракт:

| Путь | Как | Где обработчик `onErrors` | Что возвращает |
|---|---|---|---|
| `action` | обычный POST, страницу рисует сервер | на сервере | HTML с ошибками в разметке |
| `fetch` | тот же адрес, JSON из `fetch` | в браузере | `Result` в JSON |

`Result.from` — свойство результата, а не момент отрисовки: повторная отрисовка
на клиенте не пересчитывает его, показ не меняется после оживления. Обработчик
обязан быть изоморфным; браузерные вызовы — только под `ctx.from === 'fetch'`.

Браузерная сторона при перехвате проходит **тот же** `evaluate` (см. `runSubmit`),
поэтому «клиент пропустил — сервер заругался» невозможно: расхождение путей
ловят тесты сравнением списков ошибок.

Приём в SvelteKit: `+page.server.ts` вызывает `handle(request, 'action')` и
отдаёт `result` в `form`, `+server.ts` — `handle(request, 'fetch')` и `json(...)`.
В других движках — серверная функция или роут того же движка: адрес один,
контракт `Result` тот же.

## Каталог валидаторов

Все — в `v` (`validators.ts`). Каждое правило сообщает, к какому виду ограничения
относится; тип значения решает, станет ли вид атрибутом. «Атрибут» — что уходит
в разметку и работает **без скрипта**.

| Правило | Код ошибки | Атрибут | Примечание |
|---|---|---|---|
| `v.required()` | `required` | `required` | пустая строка/`null`/`false`/`[]` — пустота |
| `v.email('html5' \| 'strict')` | `email` | `pattern` (только html5) | strict строже браузера, атрибута не даёт |
| `v.url()` | `url` | — | разбор `new URL` точнее шаблона |
| `v.pattern({ source })` | `pattern` | `pattern` | именованные шаблоны — через реестр |
| `v.minLength(n)` / `v.maxLength(n)` | `minLength`/`maxLength` | `minlength`/`maxlength` | длина строки |
| `v.minValue(n, excl?)` / `v.maxValue(n, excl?)` | `minValue`/`maxValue` | `min`/`max` | величина: число, дата, время; исключающая граница не проецируется |
| `v.minDate(s)` / `v.maxDate(s)` | `minDate`/`maxDate` | `min`/`max` | ISO `ГГГГ-ММ-ДД` |
| `v.minCount(n)` / `v.maxCount(n)` | `minCount`/`maxCount` | — | количество выбранных; нативного атрибута нет |
| `v.integer()` | `integer` | `step=1` | |
| `v.step(n, unit?)` | `step` | `step` | единица важна: у даты — день |
| `v.oneOf(values)` | `oneOf` | — | список сам и есть ограничение |
| `v.accept(types)` | `accept` | `accept` | MIME или расширение; сервер смотрит содержимое |
| `v.maxSize(bytes)` | `maxSize` | — | нативного атрибута нет |
| `v.strength(level, o?)` | `strength` | `minlength` (граница уровня) | оценка в битах, не шаблон; заменяемая через `o.score` |
| `v.sameAs(field)` | `sameAs` | — | браузер не умеет сравнивать поля — проверяет сервер |
| `check(name)` | код проверки | — | асинхронная, см. [раздел](#асинхронные-проверки) |

Тексты ошибок не зашиты в валидаторы: правило отдаёт код и параметры, словарь
(`messages.ts`) превращает их в текст. Порядок разрешения: поле → форма →
приложение → пакет → код как текст. Подстановка `{min}` — из политики.

## Как добавить свой валидатор

Валидатор — обычная функция; описание себя — необязательная добавка:

```ts
import { describe, issue, opaque, registerValidator } from '$lib/form'

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
(`pattern`, `minBound`-подобные…), либо получает `opaque` — честно, без догадок.

Типы значения расширяются так же:

```ts
// declare module '$lib/form' { interface FieldValues { rating: number | null } }
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

## Как фильтровать данные

Четыре разных фильтра — не смешивайте их:

1. **Что вообще принимается.** Слой имён (`server.ts`, `namesLayer`) отвергает
   неизвестные поля, дубли одиночных значений и лишние записи — отказом, а не
   молчаливой починкой. «Взять первое значение» скрывало бы ошибку клиента или атаку.

2. **Что возвращается наружу.** `stripSecret` вырезает `secret`-поля (пароль не
   едет в разметку), `Result.values` всегда без секретов.

3. **Что показывается.** Обработчик `onErrors` — преобразование массива
   (см. `errors.ts`). Тексты можно забрать, подсветка останется:

   ```ts
   onErrors: (errors, ctx) => errors.filter((e) => e.code !== 'E123')
   // поле всё равно подсвечено: invalidFrom 'fact' считает по факту ошибки
   ```

4. **Что проверяется.** Действие задаёт объём: `validate: 'partial'` со
   `relax: ['required']` (черновик), `subset: ['email']` (проверить одно поле),
   `validate: 'none'` (операции над набором — добавление строк).

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

```ts
import { registerErrorInstruction } from '$lib/form'   // registry.registerInstruction

registry.registerInstruction({
  id: 'external-api',
  parse: ({ status, body }) => body?.errors ?? null,   // null — формат не её
  aliases: { user_email: 'email' },                    // имя службы → наше
  codeAliases: { EMAIL_TAKEN: 'email' },               // код → поле, если поле не названо
  messages: { EMAIL_TAKEN: 'Этот адрес уже занят' },
})
```

Нормализованная ошибка хранит `source` — «увести в канал именно эту службу»
или «не показывать вот этот код» делается без повторного разбора тела.

## Асинхронные проверки

Это оптимизация, а не отдельная возможность: на сервере те же проверки
выполняются всегда, отправку они не блокируют.

```ts
const checks = new CheckRegistry()
checks.register('email-taken', async (value, ctx) =>
  ctx.signal.aborted || !(await isTaken(value)) ? null : issue('email.taken'))

// в описании — обёртка с настройкой подавления
email: field.email({ validate: [v.required(), v.email(),
  check('email-taken', { debounceMs: 400, cacheByValue: true })] })
```

В браузере `AsyncRunner` даёт дебаунс, отмену предыдущей проверки того же поля
и кэш по значению. Признак «идёт проверка» — `FieldView.checking` и
`FormState.checking`.

## Повторяемые группы

Строки адресуются стабильным ключом, индекс — производное. Ошибка не съезжает
на соседнюю строку при удалении.

```ts
// описание: поля с ключом строки в имени
'items.r1.sku':  field.text({ label: 'Артикул' }),
'items.r1.qty':  field.number({ label: 'Количество', validate: [v.minValue(1)] }),

// действие
{ id: 'add-row', validate: 'none', sideEffect: 'mutate-schema' }

// связывание
const rows = form.rows('items')
rows.keys           // ['r1', ...]
rows.add()          // пропсы кнопки
rows.remove(key)
```

Операция — данные (`editor.addRow`): тот же `SchemaOp` применяется в памяти при
перехвате и на сервере при нативной отправке. Второго код-пути не существует.

## Поля из рантайма

Спецификация полностью сериализуема: валидаторы — имена из реестра, функции
запрещены на уровне типа. Поле из рантайма не исполняет чужой код.

```ts
import { compileFieldSpec } from '$lib/form'

const r = compileFieldSpec({
  name: 'extra1', input: 'tel', label: 'Телефон', required: true,
  rules: [{ rule: 'pattern', arg: 'e164' }],      // именованный шаблон из реестра
})
if (r.ok) form.apply([editor.add(r.field)])        // поле появится со всеми атрибутами
```

Набор полей не приходит от клиента: сервер поднимает описание сам по версии из
конверта (`source.ts`, `createAppSource`), протокол устаревания (`checkStale`)
переносит значения по именам и помечает новые поля свежими — обязательность
в первом круге не навязывается.

## Внешние схемы

Схема — источник **ошибок**, но не источник атрибутов: выводить разметку из
чужого словаря правил было бы догадкой. Поддержан контракт Standard Schema
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
| `unknown` | сеть упала в полёте | **не** отправлять повторно; исход `queued` с `pollUrl`/`statusUrl` — опрос |
| `queued` | принято, результат позже | опрос или ссылка без скрипта |

Идемпотентность: повтор отправки с тем же `submissionId` возвращает прежний
результат, обработчик не вызывается. Хранилище — интерфейс `IdempotencyStore`,
в памяти — `MemoryIdempotencyStore`.

Продолжение (`continuation.ts`) — всё, что при скрипте лежит в памяти, а без
него обязано пережить круг: значения без секретов, ключи строк, результат.
Носитель выбирает среда; деградация упорядочена: терять можно удобство,
нельзя гарантию.

## Проверки и бюджеты

Библиотеку охраняют два вида автоматических проверок:

- **Модульные тесты ядра.** Описание, правила, проверка, показ, конверт, редактор,
  повторяемые группы, рантайм-поля — поведение ядра, одинаковое для всех движков.
- **Стражи.** Вес библиотеки, чистота импортов, границы слоёв: ядро не импортирует
  пакетов, пакет движка разрешён только в своей зоне, адаптер не растёт быстрее
  ядра.

Бюджеты веса: raw — «вес чтения» (сколько байтов обязан прочитать тот, кто правит
библиотеку), gzip — «вес доставки» (прокси того, что уедет в браузер), адаптеры
движков — отдельной строкой каждый. Рост бюджета — осознанный: отдельным
изменением с причиной; молчаливые +10% невозможны. Текущие: 270 КБ raw /
68 КБ gzip / адаптеры: svelte 8.6 · react 8.8 · solid 7.7 КБ.
