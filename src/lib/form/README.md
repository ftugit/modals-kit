# lib/form

`lib/form` — изоморфная библиотека форм: одно описание формы используется для разметки, клиентской проверки, серверного приёма, ошибок, no-JS отправки и адаптеров UI. Ядро не рисует элементы и не привязано к Svelte, React, Solid, маршрутизатору или конкретному демо-приложению.

Главная идея: **форма — это данные и договор**, а не набор разрозненных handlers. Описание поля знает тип значения, input-представление, валидаторы, ограничения, действия, envelope и политику. Адаптеры получают уже готовые props/атрибуты и сами рендерят HTML.

## Слои и импорты

- `@modals-kit/form` — framework-neutral ядро: описание, типы, валидаторы, декодирование, проверка, envelope, результат, ошибки, runtime-спеки, continuation, queued, upload, devtools.
- `@modals-kit/form/server` — серверный конвейер приёма `Request`: защитные слои, body/name/origin checks, idempotency, throttling, execute lifecycle.
- `@modals-kit/form/svelte` — Svelte-адаптер: reactive binding, form/field/intent props, live validation, async checks, dynamic schema operations.
- `@modals-kit/form/tanstack/react` — тонкий React/TanStack Start binding поверх ядра.
- `@modals-kit/form/tanstack/solid` — тонкий Solid/TanStack Start binding поверх ядра.

Если проект публикует библиотеку под другим алиасом, замените только module specifier. Контракты ниже остаются теми же.

## Что библиотека покрывает

- декларативное описание формы через `defineForm`, `field`, `makeFieldSugar`;
- открытая модель типов значения и input-представлений;
- встроенные типы: text, number, checkbox, date, time, datetime, select, multiselect, file, files;
- встроенные валидаторы `v.*`, именованные валидаторы из registry и пользовательские validators;
- безопасная проекция валидаторов в native HTML validation attributes;
- объяснение непроецируемых ограничений через `attrsOf(name).skipped`;
- мета-валидация описания: неизвестные типы, неприменимые правила, конфликтующие границы, дубли, лимиты, небезопасные specs;
- декодирование `FormData` в значения тем же кодом на клиенте и сервере;
- structural errors для значений, которые не разбираются в тип;
- условная видимость полей;
- несколько submit-действий: full, partial, none, relax и subset;
- служебный envelope: form id, revision, instance, submission id, spec version, intent;
- нормализованный `Result` с исходами `not-applied`, `committed`, `unknown`, `queued`;
- нормализованные `FormError`: стабильные id, origin, field/common routing, `silent`, `retryable`;
- словари сообщений и переопределяемая interpolation policy;
- обработчик ошибок `ErrorHandler`, одинаковый для action и fetch путей;
- серверный handler с защитными слоями, throttling, idempotency, schema и async checks;
- continuation/no-JS persistence и контролируемая деградация больших payload;
- queued-протокол с poll/status URL;
- upload strategy: inline/reference и no-JS fallback;
- Standard Schema-like integration;
- runtime field specs без выполнения чужого кода;
- dynamic schema editor: add/remove/replace/patch/reorder fields, stable row keys;
- stale-form detection при смене revision или набора полей;
- devtools report по атрибутам, матрице применимости, routing ошибок и submissions;
- Svelte, React и Solid adapters, которые не знают имён полей конкретной формы.

## Минимальный пример описания

```ts
import { defineForm, field, v } from '@modals-kit/form'

export const signup = defineForm({
  id: 'signup',
  revision: 1,
  actions: [
    { id: 'submit', label: 'Создать аккаунт', validate: 'full', sideEffect: 'submit' },
    { id: 'save-draft', label: 'Сохранить черновик', validate: 'partial', relax: ['required'] },
  ],
  fields: {
    email: field.email({
      label: 'Почта',
      help: 'Нужна для входа и уведомлений',
      placeholder: 'name@example.com',
      validate: [v.required(), v.email(), v.maxLength(320)],
    }),
    password: field.password({
      label: 'Пароль',
      // password по умолчанию secret, но можно указать явно.
      secret: true,
      validate: [v.required(), v.minLength(10), v.strength('good')],
    }),
    confirm: field.password({
      label: 'Повторите пароль',
      validate: [v.required(), v.sameAs('password')],
    }),
    newsletter: field.checkbox({
      label: 'Получать новости',
      defaultValue: true,
    }),
  },
})
```

`defineForm()` возвращает нормализованный `FormDescription`: поля уже упорядочены, валидаторы проверены, атрибуты считаются через registry, а дефектное описание бросает `FormDefinitionError` до запуска UI.

## Жизненный цикл формы

1. Код описывает форму: поля, валидаторы, действия, policy и registry.
2. UI-адаптер получает `FormDescription` и рендерит `<form>`, hidden envelope-поля, inputs и intent-кнопки.
3. Для каждого поля adapter берёт `description.attrsOf(name).attrs` и добавляет accessibility props.
4. При перехваченной отправке adapter вызывает `evaluate()` локально, затем транспорт/server function.
5. При no-JS отправке браузер отправляет обычный POST; сервер вызывает тот же `evaluate()` или `createFormHandler()`.
6. Сервер возвращает `Result` или сохраняет continuation для повторной отрисовки.
7. Adapter применяет `Result`: обновляет values, facts, shown errors, pending/status/outcome.

Клиентский путь и no-JS путь не имеют отдельной бизнес-валидации. Они расходятся только транспортом и способом доставки результата.

## Описание формы

### `FormDefinition`

```ts
interface FormDefinition {
  id: string
  revision?: number
  fields: Record<string, FieldDraft>
  actions?: readonly ActionDescriptor[]
  messages?: Record<string, string>
  cardinality?: 'first' | 'all'
  invalidFrom?: 'fact' | 'shown'
  registry?: Registry
  policy?: FormPolicy
}
```

Важные поля:

- `id` — стабильный id формы. Он входит в envelope, `Result` и DOM ids.
- `revision` — версия описания. Повышайте при несовместимом изменении набора полей.
- `fields` — словарь `имя → черновик поля`. Ключ становится `FieldDescriptor.name`.
- `actions` — submit-намерения. Если не заданы, создаётся `submit/full`.
- `messages` — словарь сообщений формы поверх словаря приложения и встроенного словаря.
- `cardinality` — сколько ошибок собирать на поле: первая или все.
- `invalidFrom` — по чему считать поле невалидным: по фактам или только по показанным ошибкам.
- `registry` — изолированный реестр типов/валидаторов/instructions/patterns.
- `policy` — имена, лимиты, envelope keys, status codes, intent format, interpolation.

### `FieldOptions`

```ts
field.text({
  label: 'Имя',
  help: 'Как к вам обращаться',
  placeholder: 'Анна',
  defaultValue: '',
  secret: false,
  validate: [v.required(), v.minLength(2)],
  options: undefined,
  visibleWhen: { field: 'kind', equals: 'person' },
  cardinality: 'first',
  invalidFrom: 'fact',
})
```

Поле хранит одновременно:

- `kind` — тип значения после decode (`text`, `number`, `file`, свой тип и т.д.);
- `input` — HTML/UI-представление (`email`, `textarea`, `radio`, свой input и т.д.);
- `validators` — функции или сериализуемые ссылки `{ name, arg }`;
- `options` — варианты для select/radio-like controls;
- `visibleWhen` — декларативное условие видимости;
- `secret` — значение проверяется, но не возвращается в публичные `Result.values`;
- `fresh` — поле только что создано динамической операцией; required не навязывается в первом круге.

### `field.*` и `makeFieldSugar()`

`field` — Proxy-сахар над default registry. Имя свойства — input-представление:

```ts
field.text({ label: 'Текст' })
field.email({ validate: [v.email()] })
field['datetime-local']({ validate: [v.minDate('2026-01-01')] })
field.files({ validate: [v.accept(['image/*']), v.maxCount(5)] })
```

Если вы регистрируете свои типы, создайте сахар от своего registry:

```ts
import { createRegistry, makeFieldSugar } from '@modals-kit/form'

const registry = createRegistry().registerType(myMoneyType)
const f = makeFieldSugar(registry)

const invoice = defineForm({
  id: 'invoice',
  registry,
  fields: {
    amount: f.money({ label: 'Сумма' }),
  },
})
```

## Типы значений и input-представления

Модель открытая. Встроенные ключи объявлены интерфейсами `FieldValues` и `InputModes`; приложение может расширить их через module augmentation.

| Value kind | Inputs | Decode result | Empty value | Особенности |
| --- | --- | --- | --- | --- |
| `text` | `text`, `email`, `password`, `tel`, `url`, `search`, `color`, `hidden`, `textarea` | `string` | `''` | text-like attrs зависят от конкретного input |
| `number` | `number`, `range` | `number \| null` | `null` | разбирает HTML float, не `Number()`; по умолчанию ставит `step="any"` |
| `checkbox` | `checkbox` | `boolean` | `false` | отсутствие записи значит `false` |
| `date` | `date` | ISO date string \| `null` | `null` | отвергает невозможные даты вроде `2024-02-31` |
| `time` | `time` | ISO time string \| `null` | `null` | принимает секунды; базовый attrs ставит `step="any"` |
| `datetime` | `datetime-local` | ISO local datetime string \| `null` | `null` | принимает секунды; базовый attrs ставит `step="any"` |
| `select` | `select`, `radio` | `string \| null` | `null` | `oneOf` выражается самим набором options |
| `multiselect` | `multiselect` | `readonly string[]` | `[]` | native count limits отсутствуют |
| `file` | `file` | `File \| null` | `null` | `accept` — подсказка выбора, сервер всё равно проверяет |
| `files` | `files` | `readonly File[]` | `[]` | `maxCount > 1` может дать `multiple` |

Decode/encode находятся у `FieldType`. Поэтому новый тип добавляется регистрацией, а не правкой центральной таблицы.

## Ограничения и native HTML attributes

Валидатор может описать себя списком абстрактных `Constraint`: `required`, `minLength`, `minMagnitude`, `step`, `accept`, `opaque` и т.д. Тип значения решает, применим ли этот вид ограничения и можно ли безопасно превратить его в HTML-атрибут для конкретного input.

```ts
const projected = signup.attrsOf('email')
console.log(projected.attrs)
// например: { type: 'email', required: true, pattern: '...', maxlength: 320 }

console.log(projected.skipped)
// [{ kind: 'opaque', why: '...' }] для правил, которые нельзя выразить атрибутом
```

Правило безопасности: **атрибут ставится только если native constraint не строже серверной проверки и не проверяет другое условие**. Иначе ограничение остаётся в ядре, а причина попадает в `skipped`.

Примеры:

- `v.required()` → `required`, но не для `hidden`, `color`, `range`, где browser semantics отличаются.
- `v.maxLength(20)` → `maxlength` для text-like inputs и textarea.
- `v.pattern({ source })` → `pattern` только для inputs, где браузер применяет pattern.
- `v.email('html5')` → безопасный `pattern`; `v.email('strict')` не проецируется, потому что strict-проверка строже.
- `v.minValue(18)` → `min`; `v.minValue(18, true)` не проецируется, потому что HTML `min` включает границу.
- `v.integer()` → `step=1`, кроме случаев, где HTML step base от дробного `min` стал бы опасным.
- `v.step(15, 'second')` → `step=15` для `time`/`datetime-local`; неверная единица не проецируется.
- `v.strength('good')` → нижняя граница длины может стать `minlength`, но сама оценка сложности остаётся `opaque`.
- `v.sameAs('password')`, async checks, внешние схемы → `opaque`.

Это не замена JS/server validation. Native attrs — ранняя подсказка браузеру. Истина всё равно `evaluate()` и сервер.

## Встроенные валидаторы

| Валидатор | Что проверяет | Ограничения/атрибуты |
| --- | --- | --- |
| `v.required()` | непустое значение | `required` где безопасно |
| `v.email(mode)` | email; `mode`: `html5` или `strict` | html5 mode даёт `pattern`; strict opaque |
| `v.url()` | `new URL(value)` | opaque |
| `v.pattern({ source })` | regexp `^(?:source)$` | `pattern` где input поддерживает |
| `v.minLength(n)` / `v.maxLength(n)` | длина строки/массива | `minlength`/`maxlength` для подходящих inputs |
| `v.minValue(n, exclusive?)` / `v.maxValue(n, exclusive?)` | числовые границы | `min`/`max` только для inclusive |
| `v.minDate(value)` / `v.maxDate(value)` | строковые ISO границы для date/time/datetime | `min`/`max` |
| `v.minCount(n)` / `v.maxCount(n)` | количество выбранных элементов/файлов | обычно нет native attr; для `files` `maxCount > 1` помогает с `multiple` |
| `v.integer()` | целое число | `step=1`, если безопасно |
| `v.step(n, unit?)` | кратность с тем же base, что у HTML | `step` при совпадении единиц |
| `v.oneOf(values)` | значение из списка | применимо, но обычно без отдельного attr |
| `v.accept(types)` | MIME/extensions для файлов | `accept` |
| `v.maxSize(bytes)` | размер файла | нет native attr |
| `v.strength(level, opts?)` | сложность пароля | `minlength` + opaque |
| `v.sameAs(field)` | межполевое равенство | opaque |
| `check(name, policy?)` | async check marker | opaque |

Именованные встроенные validators доступны в registry, поэтому runtime specs могут использовать `{ name: 'minLength', arg: 3 }` без передачи функций.

## Действия и intent

Форма может иметь несколько действий:

```ts
actions: [
  { id: 'submit', validate: 'full', sideEffect: 'submit' },
  { id: 'save-draft', validate: 'partial', relax: ['required'] },
  { id: 'delete', validate: 'none', sideEffect: 'submit' },
]
```

Поля `ActionDescriptor`:

- `id` — имя действия;
- `label` — подпись для UI;
- `validate`:
  - `full` — обычная строгая отправка;
  - `partial` — действие может ослабить ограничения и/или проверять subset;
  - `none` — валидация ядра не выполняется;
- `relax` — виды ограничений, снятые действием, например `['required']` для черновика;
- `subset` — список полей, которые проверяются для данного действия;
- `sideEffect` — metadata для приложения: submit, mutate-schema или none.

Intent сериализуется в hidden/button field с ключом из policy (`policy.envelopeKeys.intent`). Формат тоже policy-driven:

```ts
const raw = signup.policy.intent.format('remove-row', 'items:r1')
const parsed = signup.policy.intent.parse(raw)
// { action: 'remove-row', arg: 'items:r1' }
```

Адаптеры не должны хардкодить имя поля intent или формат `action:arg` — всё берётся из `FormPolicy`.

## Envelope

Envelope — обязательный служебный контекст отправки:

```ts
interface Envelope {
  formId: string
  revision: number
  instance: string
  submissionId: string
  intent: string
  specVersion?: number
}
```

`buildEnvelope()` создаёт hidden-поля до hydration, поэтому no-JS путь получает тот же контекст:

```ts
import { buildEnvelope } from '@modals-kit/form'

const hidden = buildEnvelope({
  formId: signup.id,
  revision: signup.revision,
  instance: 'signup:default',
  submissionId: crypto.randomUUID(),
  specVersion: 3,
}, signup.policy)
```

`verifyEnvelope()` строго проверяет входящий `FormData`:

- form id должен совпасть;
- revision должен быть положительным integer;
- instance должен иметь безопасный формат и может сверяться с ожидаемым;
- submission id должен быть UUID;
- intent должен указывать на объявленное действие;
- spec version переносится в envelope как число.

Revision из клиента — не источник истины для полей. Сервер поднимает описание сам; revision нужен для диагностики/stale-протокола.

## Decode, validate, evaluate

### `decode(form, description)`

Разбирает `FormData` через `FieldType.decode()` каждого поля:

- возвращает `values`;
- structural errors кладёт отдельно;
- при structural error значение заменяется на `type.empty`, чтобы последующие правила не работали поверх мусора.

Пример: `'+20'` не принимается как `number`, потому что HTML number input тоже не отправляет такое значение как валидное число. Сервер не должен быть мягче браузера.

### `validateForm(description, values, options)`

Выполняет:

1. structural errors;
2. field validators;
3. form-level validator.

Учитывает:

- `visibleWhen`: скрытые поля не проверяются;
- `relax`: снять виды ограничений для конкретного action;
- `subset`: проверить только часть полей;
- `cardinality`: первая ошибка или все ошибки;
- `fresh`: newly-added fields не получают required в первом круге.

### `evaluate(form, description, options)`

Единая точка входа для клиента и сервера:

```ts
import { evaluate, makeRenderer, ru } from '@modals-kit/form'

const render = makeRenderer([signup.messages, ru], signup.policy.interpolate)
const ev = evaluate(formData, signup, {
  render,
  instance: 'signup:default',
  requireEnvelope: true,
  formValidator(values) {
    return values.password === values.confirm
      ? []
      : [{ code: 'password.mismatch', path: 'confirm' }]
  },
})

if (ev.fatal) {
  // envelope/form-level protocol rejected before business validation
}

if (ev.errors.length) {
  // normalized FormError[]
}
```

`Evaluation` содержит:

- `envelope?` — если envelope был принят;
- `values` — все decoded values, включая secret;
- `publicValues` — значения без secret-полей;
- `errors` — normalized errors;
- `intent` — raw intent из envelope;
- `fatal?` — критическая ошибка envelope/protocol.

## Result и outcomes

`Result` — единый ответ формы для action и fetch путей:

```ts
interface Result<TData = unknown> {
  v: 1
  formId: string
  instance: string
  submissionId: string
  ok: boolean
  status: number
  outcome: 'not-applied' | 'committed' | 'unknown' | 'queued'
  errors: readonly FormError[]
  values: Record<string, unknown>
  data?: TData
  redirect?: string
  revision: number
  from: 'action' | 'fetch'
}
```

Outcomes:

- `not-applied` — действие не применено; повтор после исправления безопасен.
- `committed` — действие зафиксировано.
- `unknown` — клиент/сервер не знает, была ли операция применена; нельзя слепо повторять.
- `queued` — запрос принят, финальный результат будет позже; нужен queued-протокол.

`status` — policy-defined код. По умолчанию: success `200`, validation failed `422`, network/abort `0`.

`redirect` пропускается серверным handler только если это относительный URL, начинающийся с `/` и не с `//`.

## Ошибки

```ts
interface FormError {
  id: string
  code: string
  message?: string
  params?: Record<string, unknown>
  path?: string
  origin: 'core' | 'server' | 'external'
  source?: unknown
  silent?: boolean
  retryable?: boolean
}
```

Правила:

- `path` есть — ошибка поля;
- `path` нет — общая ошибка формы;
- `id` стабилен и строится из `path/code/params`;
- `origin` показывает источник;
- `source` сохраняет сырой фрагмент внешней службы;
- `silent` запрещает подсветку поля даже в режиме `invalidFrom: 'fact'`;
- `retryable: false` полезен для unknown/network/server failures.

`normalizeErrors(errors, render, limits)`:

- пересчитывает стабильные ids;
- убирает дубли;
- рендерит сообщения;
- ограничивает длину сообщения и количество ошибок;
- сортирует стабильно по path/code.

`split(errors)` делит массив на `common` и `byField`.

## Facts vs shown errors

Библиотека различает два списка:

- `facts` — фактические ошибки результата;
- `shown` — ошибки после `ErrorHandler`.

`ErrorHandler` может скрыть часть ошибок, превратить field error в common error, заменить тексты, пометить ошибки silent и т.д.

```ts
import type { ErrorHandler } from '@modals-kit/form'

const onErrors: ErrorHandler = (errors, ctx) => {
  if (ctx.outcome === 'unknown') return errors
  return errors.filter((error) => error.code !== 'external.debug')
}
```

`invalidFrom` решает, откуда брать `aria-invalid`/подсветку:

- `fact` — поле остаётся невалидным, даже если текст скрыт handler;
- `shown` — поле невалидно только если ошибка осталась в shown list.

Настройка может быть на уровне поля, формы или адаптера.

## Сообщения

Валидаторы возвращают codes/params, а не готовый текст. Тексты собирает `makeRenderer()`:

```ts
import { makeRenderer, ru } from '@modals-kit/form'

const appMessages = {
  'email.taken': 'Эта почта уже занята',
  minLength: 'Минимум {min} символов',
}

const render = makeRenderer([signup.messages, appMessages, ru], signup.policy.interpolate)
render('minLength', { min: 10 })
```

Приоритет обычно такой: сообщения поля/формы → сообщения приложения → встроенный словарь → сам код.

Interpolation задаётся policy, поэтому склонения, plural rules и локализация не зашиты в validators.

## Registry

`Registry` изолирует расширения формы:

```ts
import { createRegistry } from '@modals-kit/form'

const registry = createRegistry()
  .registerValidator('taxId', () => taxId())
  .registerPattern('inn', '\\d{10}|\\d{12}')
  .registerInstruction(myServiceInstruction)
```

Registry содержит:

- `types` — `FieldTypeRegistry`;
- `validators` — `ValidatorRegistry`;
- `instructions` — `InstructionRegistry` для внешних ошибок;
- named patterns — whitelist для runtime specs.

Default registry — удобство, а не глобальная неизбежность. Для серверов с несколькими приложениями лучше создавать registry на приложение/форму.

## Свои валидаторы

### Валидатор без HTML-проекции

```ts
import { issue, type Validator } from '@modals-kit/form'

export const luhn = (): Validator<string> => (value) => {
  if (!value) return null
  return isValidCardNumber(value) ? null : issue('card.luhn')
}
```

Такой валидатор работает в `evaluate()` на клиенте и сервере, но в `attrsOf().skipped` появится `opaque`, потому что он не описал ограничения.

### Валидатор с HTML-проекцией

```ts
import { describe, issue } from '@modals-kit/form'

export const taxId = () => describe<string>(
  (value) => {
    if (!value) return null
    return /^\d{10}$|^\d{12}$/.test(value) ? null : issue('taxId')
  },
  [{ kind: 'pattern', source: '\\d{10}|\\d{12}' }],
)
```

Если поле text-like, тип `text` сможет превратить `pattern` в native `pattern`.

### Именованный валидатор

```ts
const registry = createRegistry()
  .registerValidator('taxId', () => taxId())

const form = defineForm({
  id: 'company',
  registry,
  fields: {
    inn: field.text({ validate: [{ name: 'taxId' }] }),
  },
})
```

Именованные валидаторы нужны для сериализуемых runtime specs: функция из пользователя не принимается.

## Свои типы значений

`FieldType` описывает decode/encode, применимость ограничений, projection в attrs и no-JS degradation:

```ts
import type { FieldType } from '@modals-kit/form'

export const ratingType: FieldType<number | null> = {
  kind: 'rating',
  inputs: ['rating', 'range'],
  multiple: false,
  empty: null,
  decode(entries) {
    const raw = entries.find((entry): entry is string => typeof entry === 'string') ?? ''
    if (raw.trim() === '') return { ok: true, value: null }
    const value = Number(raw)
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, code: 'type.rating', params: { raw } }
  },
  encode(value, name, out) {
    if (value !== null) out.push([name, String(value)])
  },
  constraints: {
    required: () => ({ required: true }),
    minMagnitude: (constraint) => ({ min: (constraint as { value: number }).value }),
    maxMagnitude: (constraint) => ({ max: (constraint as { value: number }).value }),
    step: (constraint) => ({ step: (constraint as { value: number }).value }),
    opaque: true,
  },
  attrs: () => ({ type: 'range', step: 'any' }),
  degradation: { withoutJs: 'ползунок оценки' },
}
```

Для типизации своих keys можно расширить интерфейсы:

```ts
declare module '@modals-kit/form' {
  interface FieldValues {
    rating: number | null
  }
  interface InputModes {
    rating: true
  }
}
```

## Constraints как словарь между validators и field types

Валидатор не должен знать все HTML inputs. Он говорит: «я ограничение такого вида». Тип значения говорит: «для этого input я умею/не умею сделать атрибут».

Встроенные виды:

- `required`;
- `minLength` / `maxLength`;
- `minMagnitude` / `maxMagnitude`;
- `minCount` / `maxCount`;
- `maxSize`;
- `step`;
- `pattern`;
- `oneOf`;
- `accept`;
- `opaque`.

Технически `ConstraintKind` открыт, но смысл нового вида должны понимать и валидатор, и тип значения. Если тип не знает kind, `defineForm()` считает это дефектом применимости.

## Policy

`FormPolicy` выносит граничные константы из ядра:

```ts
import { policyWith } from '@modals-kit/form'

const policy = policyWith({
  envelopeKeys: {
    intent: '__intent',
  },
  limits: {
    fields: 64,
    errors: 10,
    messageLength: 180,
  },
  intent: {
    format(action, arg) {
      return arg ? `${action}/${arg}` : action
    },
    parse(raw) {
      const [action = 'submit', arg] = raw.split('/')
      return arg ? { action, arg } : { action }
    },
  },
})
```

Policy включает:

- `names` — regex сегментов имён, forbidden names, max segments;
- `limits` — fields, constraints per field, options, label/help/pattern/message limits, max errors;
- `envelopeKeys` — имена hidden-служебных полей;
- `status` — canonical status codes;
- `intent` — format/parse;
- `interpolate` — подстановка параметров в сообщения.

`nameProblem()` проверяет составные имена посегментно и запрещает prototype-pollution keys вроде `__proto__`, `constructor`, `prototype`.

## Server handler

Для production/server-side приёма используйте `createFormHandler()` из server-only подмодуля:

```ts
import { createFormHandler, MemoryIdempotencyStore, windowThrottle } from '@modals-kit/form/server'
import { makeRenderer, ru } from '@modals-kit/form'

const handleSignup = createFormHandler({
  description: signup,
  instance: 'signup:default',
  origin: { allowed: ['https://app.example.com'] },
  idempotency: new MemoryIdempotencyStore(),
  throttle: windowThrottle({ limit: 10, windowMs: 60_000 }),
  messages: { 'email.taken': 'Эта почта уже занята' },
  async execute({ values, intent, commit, fail, after }) {
    if (intent === 'save-draft') {
      await saveDraft(values)
      commit()
      return { data: { saved: true } }
    }

    const exists = await emailExists(String(values.email))
    if (exists) {
      fail([{ id: '', code: 'email.taken', path: 'email', origin: 'server' }])
    }

    const user = await createUser(values)
    commit()
    after(() => sendWelcomeEmail(user.id))
    return { data: { userId: user.id }, redirect: `/users/${user.id}` }
  },
})

export async function POST(request: Request) {
  const { result, status } = await handleSignup(request, 'fetch')
  return new Response(JSON.stringify(result), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
```

### Built-in server layers

Default order:

1. `methodLayer(['POST'])` — rejects unsupported methods without reading body.
2. `originLayer(origin)` — optional Origin/Referer check.
3. `bodyLayer` — accepts `multipart/form-data` and `application/x-www-form-urlencoded`, meters body size, limits keys, values per key and file size.
4. `namesLayer` — rejects unknown fields, forbidden names and duplicates for single-value fields.

Можно передать `order`, чтобы переставить/расширить layers, но обязательные проверки нельзя просто выбросить без замены.

### Execute lifecycle

`execute(ctx)` получает:

- `values` — decoded values, включая secret;
- `intent` — raw intent из envelope;
- `request`;
- `commit()` — явное подтверждение durable success;
- `after(fn)` — side effects после commit; их сбой не отменяет committed result;
- `fail(errors, outcome?)` — business field/common errors.

Если handler «успешно вернулся», но `commit()` не был вызван, результат становится `unknown` с ошибкой `success-not-acknowledged`. Это намеренно: «не упало» не равно «зафиксировано».

Если handler падает до commit, outcome обычно `unknown`; если падает после commit — `committed`.

### Server validation order

После protective layers server handler делает:

1. поднимает описание из `source`, если задано;
2. вызывает `evaluate()`;
3. если sync errors нет — запускает Standard Schema, если задана;
4. если errors всё ещё нет — запускает async checks, если заданы;
5. если errors нет — проверяет idempotency;
6. вызывает `execute()`;
7. нормализует errors/messages и применяет `onErrors`.

Async checks и schema не запускаются поверх structural/sync errors, чтобы не проверять межполевую/внешнюю логику над мусорными values.

## Transport, `runSubmit()` и `SubmitMachine`

Ядро не делает сеть само. Адаптер или приложение предоставляет `Transport`:

```ts
import type { Transport } from '@modals-kit/form'

const transport: Transport = async ({ data, signal }) => {
  const response = await fetch('/form/signup', { method: 'POST', body: data, signal })
  if (!response.ok && response.headers.get('content-type') !== 'application/json') {
    return { kind: 'network', code: 'network.failed' }
  }
  return { kind: 'result', result: await response.json() }
}
```

`runSubmit()`:

- добавляет envelope в `FormData`;
- локально вызывает `evaluate()`;
- для `full` action может вернуть validation result без сети;
- вызывает transport;
- превращает network failure в `outcome: 'unknown'`;
- abort превращает в `outcome: 'not-applied'`;
- нормализует `from: 'fetch'`.

`SubmitMachine` управляет гонками отправок:

- `block` — новая отправка блокируется, пока старая идёт;
- `replace` — старая abort-ится;
- `queue` — новая ставится в очередь.

Сверка включает revision, потому что набор полей мог измениться во время отправки.

## State store

`FormStore` — минимальный framework-neutral store:

```ts
const store = new FormStore(initialState(description.revision))
const unsubscribe = store.subscribe(() => {
  console.log(store.getSnapshot())
})
```

`FormState` содержит:

- `status`: `idle`, `validating`, `submitting`, `queued`, `success`, `error`;
- `pending` и `pendingIntent`;
- `values`, `dirty`, `touched`;
- `submitCount`;
- `facts`, `shown`, `removed`;
- `checking` для async checks;
- `fresh` для newly-added fields;
- `result`, `outcome`.

`share(prev, next)` сохраняет ссылки неизменённых частей состояния, чтобы адаптеры могли строить granular reactivity.

## No-JS и continuation

Форма должна работать как обычный POST:

1. `<form method="post" enctype="multipart/form-data">`;
2. hidden envelope-поля через `buildEnvelope()` или adapter `.hidden()`;
3. submit buttons с intent;
4. сервер вызывает тот же `evaluate()`/`createFormHandler()`;
5. результат показывается после повторной отрисовки.

`Continuation` описывает состояние, которое переживает круг без JS:

```ts
interface Continuation {
  formId: string
  instance: string
  revision: number
  specVersion?: number
  submissionId: string
  rowKeys: readonly string[]
  values: Record<string, unknown>
  result?: Result
  iat: number
  exp: number
  truncated?: 'values'
}
```

Хранилище выбирает приложение:

```ts
interface ContinuationStore {
  read(ctx: unknown): Promise<Continuation | undefined> | Continuation | undefined
  write(c: Continuation, ctx: unknown): Promise<unknown> | unknown
  clear(ref: unknown, ctx: unknown): Promise<void> | void
}
```

Помощники:

- `makeContinuation()` — добавляет `iat/exp`;
- `addressedTo()` — проверяет formId/instance/ttl;
- `continuationKey()` — ключ изоляции формы;
- `factsOf()` — ошибки результата;
- `degrade()` — уменьшает payload, если носитель ограничен.

Деградация упорядочена:

- level `0` — всё помещается;
- level `1` — длинные string values урезаны;
- level `3` — values отброшены.

Ошибки не отбрасываются ради values: форма не должна становиться немой ради экономии байтов.

## Async checks

Async checks — оптимизация UX, а не единственный источник истины. На сервере те же checks выполняются всегда, если передан `CheckRegistry`.

```ts
import { CheckRegistry, check, issue } from '@modals-kit/form'

const checks = new CheckRegistry()
  .register('emailAvailable', async (value, ctx) => {
    if (!value) return null
    const ok = await isEmailAvailable(String(value), ctx.signal)
    return ok ? null : issue('email.taken')
  })

const form = defineForm({
  id: 'signup',
  fields: {
    email: field.email({ validate: [v.required(), v.email(), check('emailAvailable')] }),
  },
})
```

`check(name, policy?)` добавляет sync-validator marker, который всегда пропускает синхронно и описывает себя как `opaque`.

`AsyncRunner` для браузера умеет:

- debounce;
- abort предыдущего запроса того же поля;
- cache by value;
- timeout;
- pending count.

Отправку формы async check не блокирует: сервер всё равно проверяет окончательно.

## Standard Schema-like integration

Внешняя schema — источник ошибок, но не источник HTML attrs. Библиотека не пытается угадать constraints чужого словаря.

```ts
import { runSchema } from '@modals-kit/form'

const errors = await runSchema(schema, values)
```

Контракт минимальный:

```ts
interface StandardSchemaLike<T = unknown> {
  '~standard': {
    validate(value: unknown): StandardResult<T> | Promise<StandardResult<T>>
  }
}
```

Issues схемы превращаются в `FormError` с code `schema`, message из issue и path из issue path.

## Внешние службы и normalization

`normalizeService()` переводит произвольный ответ внешней службы в `FormError[]` по инструкции:

```ts
import { normalizeService, type ErrorInstruction } from '@modals-kit/form'

const instruction: ErrorInstruction = {
  id: 'billing',
  parse({ status, body }) {
    if (!body || typeof body !== 'object') return null
    const errors = (body as { errors?: unknown }).errors
    return Array.isArray(errors)
      ? errors.map((e) => ({
          code: String((e as any).code ?? status),
          field: typeof (e as any).field === 'string' ? (e as any).field : undefined,
          message: typeof (e as any).message === 'string' ? (e as any).message : undefined,
        }))
      : null
  },
  aliases: { email_address: 'email' },
  codeAliases: { EMAIL_TAKEN: 'email' },
  messages: { EMAIL_TAKEN: 'Эта почта уже занята' },
}

const errors = normalizeService({ status: 422, body, instruction })
```

Если parse вернул `null`, библиотека не молчит: создаётся общая ошибка `service.<status>`.

## Runtime field specs

Runtime specs нужны, когда поля создаёт пользователь или конфигурация. Они полностью сериализуемы: функции запрещены.

```ts
import { compileFieldSpecs } from '@modals-kit/form'

const compiled = compileFieldSpecs([
  {
    name: 'department',
    input: 'select',
    label: 'Отдел',
    required: true,
    options: [
      { value: 'sales', label: 'Sales' },
      { value: 'support', label: 'Support' },
    ],
    rules: [{ rule: 'oneOf', arg: ['sales', 'support'] }],
  },
], {
  prefix: 'u_',
  registry: signup.registry,
  policy: signup.policy,
})
```

Защита runtime specs:

- имя проверяется до добавления prefix;
- имя не может содержать `.`;
- functions в spec запрещены;
- unknown input/kind/validator отклоняется;
- custom pattern запрещён, если `allowCustomPattern` не включён;
- слишком длинный pattern отклоняется;
- вложенные квантификаторы в custom pattern отклоняются как ReDoS-риск;
- итоговый `FieldDescriptor` проходит `checkFieldDefinition()`.

`createAppSource(base, store)` объединяет code-defined form с runtime specs из `UserFieldStore`. Клиент не присылает список полей; сервер поднимает описание сам по formId/specVersion.

## Dynamic schema editor

Операции изменения схемы — данные, не callbacks:

```ts
import { applyOps, editor } from '@modals-kit/form'

const next = applyOps(description, [
  editor.add(field.text({ label: 'Комментарий' }) as any),
  editor.patch('email', { help: 'Рабочая почта' }),
  editor.reorder(['email', 'password', 'comment']),
])
```

Операции:

- `add(field)`;
- `remove(name)`;
- `replace(name, next)`;
- `patch(name, part)`;
- `reorder(order)`;
- `addRow(group, rowKey)`;
- `removeRow(group, rowKey)`;
- `moveRow(group, rowKey, 'up' | 'down')`.

`applyOps()` атомарен: сначала строит новый набор полей, потом один раз вызывает `defineForm()`. Подписчики не видят промежуточное неконсистентное состояние.

Повторяемые группы адресуются стабильным `rowKey`, а не индексом массива. Индекс — производное представление (`toIndexPath()`), не источник истины.

`reconcile(next, prev, state)` переносит состояние на новую ревизию:

- значения существующих совместимых полей сохраняются;
- новые/fresh поля получают default/empty;
- несовместимая смена kind сбрасывает значение и добавляет common error `value.incompatible`;
- dirty/touched переносятся по именам;
- ошибки сохраняются только если constraints поля не менялись.

`assertConsistent()` ловит orphan values/errors и required errors на fresh fields.

## Stale forms и description source

Если пользователь отправляет страницу со старой ревизией формы, сервер может определить stale-ситуацию:

```ts
import { checkStale, fieldSetHash } from '@modals-kit/form'

const claimed = {
  revision: Number(formData.get('__form_rev')),
  fieldSetHash: String(formData.get('__field_set') ?? ''),
}

const verdict = checkStale(serverDescription, claimed, decodedValues)
```

`checkStale()` возвращает:

- `{ stale: false }`, если revision/hash совпали;
- `{ stale: true, reason, fresh, carried, dropped }`, если нужно перенести значения и показать новую форму.

Значения переносятся по именам. Поля, которых больше нет, попадают в `dropped`. Новые поля в fresh description не должны сразу блокировать required.

## Queued results

`queued` outcome означает: запрос принят, но финального результата пока нет. Такой исход обязан иметь протокол:

```ts
import { assertQueuedProtocol, queuedData, pollUntilDone } from '@modals-kit/form'

assertQueuedProtocol(result)
const data = queuedData(result)
```

`QueuedData`:

```ts
interface QueuedData {
  pollUrl: string
  statusUrl: string
  etaMs?: number
}
```

- `pollUrl` — автоматический polling при JS;
- `statusUrl` — обязательная человеческая ссылка без JS;
- `etaMs` — необязательная оценка ожидания.

Если `queued` вернулся без `pollUrl` и `statusUrl`, `assertQueuedProtocol()` бросает `QueuedWithoutProtocolError`: форма иначе не знает, что показывать, а no-JS путь становится тупиком.

## Uploads

Файлы поддерживаются двумя стратегиями:

```ts
import { INLINE, effectiveMode, type UploadStrategy } from '@modals-kit/form'

const inline = INLINE
const referenced: UploadStrategy = {
  mode: 'reference',
  endpoint: '/uploads',
  maxBytes: 20 * 1024 * 1024,
}

const mode = effectiveMode(referenced, canUploadWithJavaScript)
```

- `inline` — файл идёт в теле формы; работает без JS.
- `reference` — файл заранее грузится отдельной точкой, а форма хранит `UploadRef`.

Без JS `reference` деградирует в `inline`, потому что отдельная загрузка требует скрипта. Это должно учитываться серверными body/file limits.

`accept` — native подсказка выбора файла, не security guarantee. Сервер всё равно проверяет тип/размер.

## Devtools report

`DevReport` строит диагностический отчёт из registry и description:

```ts
import { DevReport } from '@modals-kit/form'

const report = new DevReport(signup)
console.table(report.attributes())
console.table(report.matrix())
console.log(report.health())
console.log(report.report())
```

Доступно:

- `attributes()` — field/input/constraints/attrs/skipped;
- `matrix()` — какие constraint kinds принимает каждый registered type;
- `routing(errors)` — code/path/origin/shown/silent;
- `record(entry)` и `submissions()` — журнал отправок;
- `health()` — доля спроецированных constraints, opaque count, unknown kind count, defects;
- `report()` — текстовая сводка.

## Svelte adapter

Импорт:

```ts
import { createConfig, bind } from '@modals-kit/form/svelte'
```

`createConfig()` задаёт проектные defaults:

```ts
const forms = createConfig({
  resolve(field) {
    return components[field.input]
  },
  messages: { 'email.taken': 'Эта почта уже занята' },
  actionBase: '/forms',
  live: 'after-touched',
  parallel: 'block',
  invalidFrom: 'fact',
  transport,
  onErrors,
  ui: {
    fieldId: (formId, name) => `${formId}-${name.replace(/\./g, '-')}`,
  },
})
```

`bind(config, description, options)` возвращает bound form:

```ts
const form = bind(forms, signup, {
  instance: 'signup:default',
  action: '/forms/signup',
  intercept: true,
  transport,
  checks,
})
```

Основные части bound API:

- `form.description` — текущий `FormDescription`;
- `form.instance`;
- `form.state`, `form.values`, `form.facts`, `form.shown`, `form.common`;
- `form.formProps()` — props для `<form>`;
- `form.hidden()` — hidden envelope inputs;
- `form.intent(id)` — props для submit button;
- `form.submit(formData)` — программная отправка;
- `form.lift(result)` — применить result, пришедший через action/continuation;
- `form.apply(ops)` — dynamic schema operations;
- `form.rows(group)` — stable row API;
- `form.f.name` / `form.field(name)` — `FieldView`;
- `form.custom(prefix)` — runtime-created fields by prefix;
- `form.select(selector)` — выбор из state.

`FieldView` содержит:

- `attrs` — готовые attrs для input;
- `skipped` — непроставленные constraints;
- `label`, `help`, `placeholder`, `options`;
- `errors`, `has`, `touched`, `dirty`, `fresh`, `checking`;
- `labelProps()`, `helpProps()`, `errorProps()`;
- `setTouched()` и `onInput(raw)`.

Svelte adapter — самый полный adapter слоя UI: он поддерживает live validation, async check scheduling, schema operations и rows поверх framework-neutral ядра.

## TanStack React adapter

Импорт:

```tsx
import { createReactForm } from '@modals-kit/form/tanstack/react'
```

Adapter создаёт hook factory:

```tsx
const useSignupForm = createReactForm({
  instance: 'signup:default',
  invalidFrom: 'fact',
})

function SignupPage() {
  const form = useSignupForm(signup, {
    action: '/forms/signup',
    submitOnServer: (data) => submitSignup({ data }),
  })

  const email = form.field('email')

  return (
    <form {...form.formProps}>
      {form.hidden().map((hidden) => <input key={hidden.name} {...hidden} />)}

      <label {...email.labelProps}>{email.descriptor.label}</label>
      <input {...email.inputProps} />
      {email.errors.map((error) => (
        <p key={error.id} {...email.errorProps}>{error.message}</p>
      ))}

      <button type="submit" {...form.intent('submit')}>Submit</button>
      <button type="submit" {...form.intent('save-draft')}>Save draft</button>
    </form>
  )
}
```

React adapter:

- не знает конкретной формы, names, messages или server actions;
- берёт native attrs из `description.attrsOf(name)`;
- конвертирует DOM prop names: `minlength → minLength`, `maxlength → maxLength`, `inputmode → inputMode`, `readonly → readOnly`, `formnovalidate → formNoValidate`;
- делает local `evaluate()` перед `submitOnServer`;
- поддерживает hidden envelope, intent buttons, field errors, common errors, pending state;
- оставляет server function/route на стороне приложения.

Это thin adapter. Dynamic rows/live async checks можно строить над framework-neutral APIs, но они не зашиты в React binding.

## TanStack Solid adapter

Импорт:

```tsx
import { For } from 'solid-js'
import { createSolidForm } from '@modals-kit/form/tanstack/solid'
```

Использование:

```tsx
const useSignupForm = createSolidForm({
  instance: 'signup:default',
  invalidFrom: 'fact',
})

function SignupPage() {
  const form = useSignupForm(signup, {
    action: '/forms/signup',
    submitOnServer: (data) => submitSignup({ data }),
  })

  const email = form.field('email')

  return (
    <form {...form.formProps()}>
      <For each={form.hidden()}>{(hidden) => <input {...hidden} />}</For>

      <label {...email.labelProps()}>{email.descriptor.label}</label>
      <input {...email.inputProps()} />
      <For each={email.errors()}>{(error) => (
        <p {...email.errorProps()}>{error.message}</p>
      )}</For>

      <button type="submit" {...form.intent('submit')}>Submit</button>
      <button type="submit" {...form.intent('save-draft')}>Save draft</button>
    </form>
  )
}
```

Solid adapter mirrors React adapter with Solid signals/accessors:

- `form.formProps()`;
- `form.hidden()`;
- `form.intent(id)`;
- `form.field(name)`;
- `form.common()`;
- `form.state.pending()`, `form.state.values()`, `form.state.facts()`, `form.state.shown()`, `form.state.result()`.

## Равенство между фреймворками

Одинаковая часть для всех adapters:

- `FormDescription`;
- registry/policy;
- decode/validate/evaluate;
- native attrs projection;
- envelope/intent;
- Result/FormError;
- messages/error handling;
- server handler;
- runtime specs/source/stale logic.

Различается только слой удобства adapter:

- Svelte adapter сейчас покрывает больше UI-state операций из коробки: live validation, async runner integration, dynamic schema ops, row helpers.
- React/Solid TanStack adapters тонкие: они дают корректный form/field/intent binding и server submit hook, но не хардкодят приложение и не дублируют всё Svelte convenience API.
- Если React/Solid приложению нужны rows, runtime field editor или polling UI, используйте те же core APIs (`editor`, `applyOps`, `SubmitMachine`, `AsyncRunner`, `pollUntilDone`) в собственном state layer.

Иными словами: **инварианты формы одинаковые**, UI ergonomics adapters могут отличаться.

## Безопасность и отказ от молчаливой починки

Библиотека предпочитает явный отказ вместо угадывания:

- неизвестное поле в request → `request.unexpected-field`;
- duplicate value для single field → `request.duplicate`;
- envelope mismatch → envelope error;
- unknown validator/type → `FormDefinitionError`;
- неприменимое ограничение к типу → defect;
- unsafe/excessive runtime pattern → defect;
- queued без protocol → exception;
- success без `commit()` → `unknown`;
- network failure → `unknown`, не `not-applied`;
- secret values вырезаются из public `values`;
- objects создаются через `safeObject()` без prototype chain.

## HTML rendering checklist для любого adapter

Adapter/приложение должно:

1. Рендерить `<form method="post" enctype="multipart/form-data">`.
2. Рендерить все hidden поля из `buildEnvelope()` / `.hidden()` внутри form.
3. Для submit buttons использовать `name = policy.envelopeKeys.intent` и `value = policy.intent.format(...)`.
4. Для каждого input разворачивать `description.attrsOf(name).attrs`.
5. Добавлять `name` и стабильный `id`.
6. Связывать `<label for>` с input id.
7. Включать help/error ids в `aria-describedby`.
8. Для field errors ставить `aria-errormessage` и `role="alert"` на error block.
9. Ставить `aria-invalid` по `hasError()` и выбранному `invalidFrom`.
10. Не полагаться только на native validation: сервер всё равно вызывает `evaluate()`/`createFormHandler()`.

## Расширение: краткие рецепты

### Свой renderer сообщений

```ts
const render = makeRenderer([
  form.messages,
  { required: 'Заполните поле', 'email.taken': 'Почта занята' },
  ru,
], form.policy.interpolate)
```

### Скрыть часть ошибок из UI, но оставить подсветку

```ts
const onErrors: ErrorHandler = (errors) =>
  errors.filter((error) => error.code !== 'external.debug')

const form = defineForm({
  id: 'x',
  invalidFrom: 'fact',
  fields: { email: field.email({ validate: [v.required()] }) },
})
```

### Перевести ошибку поля в общую

```ts
const onErrors: ErrorHandler = (errors) =>
  errors.map((error) => error.code === 'email.taken'
    ? { ...error, path: undefined }
    : error)
```

### Частичная проверка action

```ts
actions: [
  { id: 'profile', validate: 'partial', subset: ['name', 'email'] },
  { id: 'security', validate: 'partial', subset: ['password', 'confirm'] },
]
```

### Проверка всей формы после полей

```ts
const ev = evaluate(data, form, {
  render,
  formValidator(values) {
    if (values.password !== values.confirm) {
      return [{ code: 'sameAs', path: 'confirm', params: { field: 'password' } }]
    }
    return []
  },
})
```

### Idempotency

```ts
const handler = createFormHandler({
  description: form,
  idempotency: new MemoryIdempotencyStore(),
  execute(ctx) {
    // repeated submissionId returns previous Result instead of executing twice
    ctx.commit()
    return { data: { ok: true } }
  },
})
```

## Публичная поверхность по темам

Описание и registry:

- `defineForm`, `field`, `makeFieldSugar`;
- `createRegistry`, `defaultRegistry`, `Registry`;
- `FieldDescriptor`, `FieldDraft`, `FormDescription`, `ActionDescriptor`, `VisibilityCondition`;
- `FormDefinitionError`, `FieldDefect`, `checkFieldDefinition`.

Типы и constraints:

- `FieldType`, `FieldTypeRegistry`, `projectAttrs`, `applies`;
- `Constraint`, `ConstraintKind`, `opaque`, `boundValue`;
- `FieldValues`, `InputModes`, `ValueKind`, `InputMode`, `HtmlAttrs`.

Валидация:

- `v`, `issue`, `describe`, `Validator`, `ValidatorRef`, `ValidatorRegistry`, `constraintsOf`;
- `decode`, `encode`, `stripSecret`;
- `validateForm`, `isVisible`, `visibleFields`;
- `evaluate`, `runSubmit`, `SubmitMachine`.

Ошибки и результат:

- `FormError`, `Result`, `Outcome`, `normalizeErrors`, `stableId`, `stableStringify`;
- `applyHandler`, `split`, `hasError`, `invalidFromFor`;
- `makeRenderer`, `ru`;
- `normalizeService`, `InstructionRegistry`.

Runtime/dynamic:

- `compileFieldSpec`, `compileFieldSpecs`, `FieldSpec`, `SpecRule`;
- `applyOps`, `editor`, `reconcile`, `groupRows`, `ageFields`, `assertConsistent`;
- `createAppSource`, `appendFields`, `fieldSetHash`, `checkStale`.

No-JS/async/queued/upload/devtools:

- `Continuation`, `ContinuationStore`, `makeContinuation`, `degrade`, `addressedTo`;
- `CheckRegistry`, `check`, `AsyncRunner`, `runAsyncChecks`;
- `QueuedData`, `queuedData`, `assertQueuedProtocol`, `pollUntilDone`;
- `UploadStrategy`, `INLINE`, `effectiveMode`, `UploadRef`;
- `DevReport`.

Server-only:

- `createFormHandler`, `methodLayer`, `originLayer`, `bodyLayer`, `namesLayer`;
- `MemoryIdempotencyStore`, `windowThrottle`;
- `DEFAULT_LIMITS`, `reject`, `Layer`, `HandlerOptions`, `ExecuteContext`.

## Ключевые гарантии

- Core не зависит от Svelte/React/Solid/DOM rendering.
- Описание формы не приходит от клиента; сервер поднимает его сам.
- Native HTML attrs выводятся только из безопасно проецируемых constraints.
- JS и no-JS paths используют один `evaluate()`.
- Секретные поля не возвращаются в public `Result.values`.
- Runtime specs не исполняют функции пользователя.
- Ошибки имеют стабильные ids и единый routing.
- Unknown outcome не маскируется под validation failure.
- Adapter code не должен знать form-specific names, messages, actions или server functions.
