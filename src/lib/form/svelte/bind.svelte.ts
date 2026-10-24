// Слой Svelte: единственное место, где ядро встречается с реактивностью.
//
// Библиотека не создаёт ни одного элемента: всё ниже — наборы пропсов.
import { createAttachmentKey } from 'svelte/attachments'
import type { Component } from 'svelte'
import { AsyncRunner, asyncRefsOf, valuesForChecks, type CheckRegistry } from '../async'
import type { ConstraintKind } from '../constraints'
import { fieldLinkState, type FieldDescriptor, type FieldLink, type FormDescription, type InvalidFrom } from '../describe'
import { applyHandler, hasError, invalidFromFor, notifyResultErrors, split, type ErrorContext, type ErrorSink, type ErrorHandler } from '../errors'
import type { UrlCommitVia, UrlFormOptions } from '../url'
import { buildEnvelope } from '../envelope'
import { formRenderer } from '../messages-order'
import { isSettled, normalizeErrors, type FormError, type Result } from '../result'
import { isPinned, pinErrors, reconcilePins, type Pin } from '../pins'
import { blockingOpErrors, opError, opPin, type OpErrorInput } from '../takeover'
import { FormStore, initialState, type FormState } from '../state'
import { defaultValueMap } from '../defaults'
import { evaluate, runSubmit, SubmitMachine, type Transport } from '../submit'
import { disabledState } from '../validate'
import type { HtmlAttrs } from '../types'
import type { BoundConfig, LiveMode } from './config'
import { DEV } from 'esm-env'

/**
 * Привязка к узлу едет ВНУТРИ набора пропсов — как `ref` в других движках.
 * Приложение разворачивает `{...attrs}` и этим регистрирует поле; забыть
 * регистрацию нельзя, потому что забывать нечего.
 */
const ATTACH = createAttachmentKey()

/**
 * Внутренний канал «снимок поля → живая ручка»: `viewOf` вешает ручку
 * перехватчика на каждый `FieldView` неперечисляемым символьным ключом.
 * Читает только `Field` (кит полей), когда у него объявлен `takeover`;
 * компоненты полей канал не видят (в спред пропсов он не попадает).
 */
export const FIELD_HANDLE: unique symbol = Symbol('form/field-handle')

/** Атрибуты `<form>` от связки: путь отправки, метод и перехват `onsubmit`. */
export interface FormProps {
  /** Метод отправки: `post` для мутаций, `get` для форм-фильтров. */
  method: 'post' | 'get'
  /** Адрес отправки: текущая страница или явный `action` из настроек связки. */
  action: string
  /** Кодировка тела, когда в форме есть файлы. */
  enctype?: 'multipart/form-data'
  /** Перехват отправки: без JS остаётся нативный путь (обработчик просто не сработает). */
  onsubmit: (e: SubmitEvent) => void
  /** Признак «идёт отправка» — для стилей и `aria-busy`. */
  'aria-busy'?: true
  [key: symbol]: unknown
}

/** Скрытый вход конверта (`__form_id`, версия и экземпляр): рисуется связкой, не описанием. */
export interface HiddenProps {
  type: 'hidden'
  /** Служебное имя ключа конверта. */
  name: string
  /** Значение ключа для этой отправки. */
  value: string
  readonly: true
}

/** Атрибуты кнопки-намерения (`intent`): имя, значение и обход нативной проверки. */
export interface IntentProps {
  /** Имя поля намерения (`intent` или своё, по политике формы). */
  name: string
  /** Значение намерения — его сервер читает как `intent`. */
  value: string
  /** Снять нативную проверку браузера: проверяет только выбранные поля. */
  formnovalidate?: boolean
  /** Кнопка недоступна (например, идёт другая отправка). */
  disabled?: boolean
  /** На этой кнопке идёт отправка. */
  'aria-busy'?: true
}

/** Данные одного поля. `attrs` содержит всё, что обязано быть на элементе. */
export interface FieldView {
  readonly name: string
  readonly input: FieldDescriptor['input']
  readonly kind: FieldDescriptor['kind']

  readonly attrs: HtmlAttrs
  /** Ограничения, не ставшие атрибутами, с причиной. */
  readonly skipped: readonly { kind: ConstraintKind; why: string }[]

  readonly label?: string
  readonly help?: string
  readonly placeholder?: string
  /** Вариант показа из описания поля: по нему `resolve` выбирает компонент. */
  readonly variant?: string
  readonly options?: readonly { value: string; label: string; disabled?: boolean }[]
  /** Тексты: то, что вернул обработчик. Может быть пусто при невалидном поле. */
  readonly errors: readonly FormError[]

  readonly value: unknown
  /** Значение по умолчанию из описания: им поле стартует, пока `value` не задано. */
  readonly defaultValue?: unknown
  /** Каталог `field.fields`: виды и правила для мест под поля. */
  readonly fieldSet?: FieldDescriptor['fieldSet']
  /** Факт невалидности. Источник настраивается: по факту или по показу. */
  readonly has: boolean
  readonly touched: boolean
  readonly dirty: boolean
  /** Идёт асинхронная проверка. */
  readonly checking: boolean
  /** Поле выключено связкой: видно, но недоступно (disabled ≠ скрыто). */
  readonly disabled?: boolean
  /** Причина выключения — рисуется в helper-слоте; бывает только у выключенного поля. */
  readonly reason?: string
  /** `Result.notes`: значение изменил `prepare`. */
  readonly note?: string

  labelProps(): { for: string }
  helpProps(): { id: string } | undefined
  errorProps(): { id: string; role: 'alert' } | undefined
  noteProps(): { id: string } | undefined

  setTouched(v?: boolean): void
  onInput(raw: unknown): void
}

/**
 * Живая ручка поля для перехватчика (`Field takeover`): тот же набор, что
 * у `FieldView`, но чтение — текущее состояние при каждом доступе, а не
 * снимок. Писателей ровно два и оба — СВОЙСТВА (функций вида
 * getValue/setValue/setError нет осознанно: значение и ошибки уже
 * читаются через `value`/`errors`, значение пишется через `onInput`).
 * Компоненты полей ручку не получают — писателей у них нет по типу;
 * исключение — заменяющий компонент самого перехватчика (проп `f`).
 */
export interface FieldHandle extends FieldView {
  /**
   * Ошибка операции поля (подготовка значения не удалась): `origin:
   * 'external'`, закреплена за текущим значением носителя (pins) — видна
   * до смены значения, собственная проверка поля сильнее, блокирует
   * клиентскую отправку полных действий; сервер её не воспроизводит.
   * Ставить ПОСЛЕ приведения носителя в итоговое состояние: закреп — за
   * тем значением, что в DOM сейчас. `undefined` — снять. Чтение —
   * последнее присвоенное; показ и блокировку решают pins по значению.
   */
  error: OpErrorInput | undefined
  /**
   * Подготовка значения в полёте: пока задан, отправка ждёт его
   * завершения и затем перечитывает `FormData` из DOM — носитель за это
   * время мог измениться (DataTransfer в carrier + `onInput`). Новое
   * присвоение заменяет прежнее; `undefined` — ожидания нет.
   */
  pending: Promise<unknown> | undefined
}

/** Что callback перехвата может вернуть: замена вида и/или уборка. */
export interface FieldTakeoverMount {
  /**
   * Компонент вместо штатного. Получает живую ручку поля пропом `f` —
   * тот же объект, что callback: через неё и вид поля (`attrs`/`value`/
   * `errors`), и писатели операции.
   */
  view?: Component<{ f: FieldHandle }>
  /** Примитив кита, который замещает `view` (тот, что дал бы resolve полю). */
  base?: unknown
  /** Уборка при размонтировании поля. */
  dispose?: () => void
}

/**
 * Перехват поля: callback у компонента `Field`, у конкретного поля
 * (`<Field of={bound.f.x} takeover={(f) => …}>`). Вызывается один раз
 * после оживления (клиент); до оживления и без JS работает штатный
 * компонент поля — noJS остаётся честным, сервер перехвата не видит
 * (описание формы функций не несёт). Возврат может заменить видимый
 * компонент (`base` сверяет `Field`) и/или дать уборку; без возврата —
 * чистое поведение.
 */
export type FieldTakeover = (f: FieldHandle) => FieldTakeoverMount | void

/** Настройка связывания: перекрывает проектную конфигурацию. */
export interface BindOptions {
  /** Адрес нативной отправки (или геттер живого адреса). По умолчанию — `actionBase/id`. */
  action?: string | (() => string)
  /** Экземпляр формы: адресует продолжение. Умолчание — `id:new`. */
  instance?: string
  /** Версия спецификации для источника описания. */
  specVersion?: number
  /**
   * Накопленное после нативной отправки: у SvelteKit это свойство `form`.
   * Поднимается СИНХРОННО при связывании — без скрипта эффектов не бывает,
   * и ошибки обязаны попасть уже в серверную разметку.
   */
  continuation?: Result | null
  submissionId?: string
  /** Перехватывать отправку. `false` — обычный POST, разметка без `novalidate`. */
  intercept?: boolean
  /** Режим живой проверки. */
  live?: LiveMode
  /** Транспорт: сеть делает движок. */
  transport?: Transport
  /** Обработчик ошибок формы. Перекрывает проектный. */
  onErrors?: ErrorHandler
  /** Приёмник системных ошибок (Q1). Перекрывает проектный. */
  onError?: ErrorSink
  /** URL-контур (§6.4): GET до гидратации, живой коммит в sink хоста после. */
  url?: UrlFormOptions
  /** Источник подсветки: по факту или по показу. */
  invalidFrom?: InvalidFrom
  /** Асинхронные проверки. На сервере те же выполняются всегда. */
  checks?: CheckRegistry
  /**
   * Канал решений о доступности: ответ перекрывает `disabledWhen` и объявление.
   * `values` — живое зеркало формы (C6): решение — от выбранного сейчас.
   */
  fieldState?: (name: string, values: Readonly<Record<string, unknown>>) => FieldLink | undefined
}

/**
 * Связать описание формы с реактивностью Svelte.
 * @param cfg Настройка проекта из `createConfig`.
 * @param desc Описание формы.
 * @param o Перекрытия для этой формы.
 * @returns Связка: состояние, поля, отправка.
 */
export function bind(cfg: BoundConfig, desc: FormDescription, o: BindOptions = {}) {
  const instance = o.instance ?? `${desc.id}:new`
  const resolveAction = () =>
    typeof o.action === 'function' ? o.action() : (o.action ?? `${cfg.config.actionBase ?? ''}/${desc.id}`)
  const render = formRenderer(desc.messages as never, cfg.config.messages,
                              desc.policy.interpolate)
  const runner = o.checks ? new AsyncRunner(o.checks) : undefined
  const asyncErrorIds = new Map<string, string>()

  // Умолчания описания — это ЗНАЧЕНИЯ формы, а не только атрибут разметки:
  // без этого `Select` не показывал умолчание, а стёртое поле возвращало его
  // в `value` (ход 224). Сид адреса/сервера ложится поверх.
  const store = new FormStore(initialState(desc.revision, defaultValueMap(desc)))
  const machine = new SubmitMachine(cfg.config.parallel ?? 'block')

  let submissionId = o.submissionId ?? crypto.randomUUID()
  let snapshot = $state.raw<FormState>(store.getSnapshot())
  store.subscribe(() => { snapshot = store.getSnapshot() })

  let formEl: HTMLFormElement | null = null

  // S2: «живой режим после гидратации». $effect исполняется только в браузере:
  // флаг переворачивается на оживлении, при размонтировании — возвращается.
  let hydrated = $state(false)
  $effect(() => {
    if (!o.url) return
    hydrated = true
    return () => { hydrated = false }
  })

  // Размонтирование: отправка в полёте и проверки (таймеры дебаунса, запросы)
  // не переживают компонент — иначе они дописывали бы состояние ушедшей формы.
  $effect(() => () => {
    machine.abort('unmounted')
    runner?.cancel()
  })

  // URL-режим: начальное зеркало значений от хоста (из хранилища, не из адреса —
  // адрес сеет сервер в load, хост читает состояние). Валидация молчит: fields
  // показывают значения, а не претензии. Сид ложится ПОВЕРХ умолчаний: пустые
  // ключи хоста умолчание не снимают (иначе адрес без поля обнулял бы его).
  if (o.url?.seed) {
    const seeded = o.url.seed(desc)
    if (seeded) store.set((st) => ({ ...st, values: { ...st.values, ...seeded } }))
  }

  const handler = () => o.onErrors ?? cfg.config.onErrors
  const liveMode = () => o.live ?? cfg.config.live ?? 'after-touched'
  const invalidMode = (name: string): InvalidFrom =>
    o.invalidFrom ?? invalidFromFor(name, desc, cfg.config.invalidFrom ?? 'fact')

  /** Факты в показ: один обработчик, оба пути. */
  function display(facts: readonly FormError[], ctx: ErrorContext) {
    const shown = applyHandler(facts, ctx, handler())
    if (DEV && shown.removed > 0)
      console.warn(`[form] обработчик убрал ${shown.removed} из ${facts.length} ошибок`)
    return shown
  }

  /** Повторно применить текущий обработчик к сохранённым фактам.
   * Полезно для интерактивных настроек демо: сеть и валидация
   * повторно не запускаются, меняется только слой показа.
   */
  function redisplay() {
    const s = store.getSnapshot()
    const result = s.result
    const ctx: ErrorContext = {
      from: result?.from ?? 'fetch',
      intent: desc.policy.intent.parse(s.pendingIntent ?? 'submit').action,
      outcome: result?.outcome ?? s.outcome ?? 'not-applied',
    }
    const shown = display(s.facts, ctx)
    store.set((current) => ({ ...current, shown: shown.errors, removed: shown.removed }))
  }

  function applyResult(result: Result, sent?: FormData, notify = true) {
    // ошибки операций перехватчиков своими закрепами уже учтены (opPins):
    // второй закреп той же ошибки из результата дал бы дубль в фактах
    pins = pinErrors(result.errors, (n) => !!desc.byName[n], sent)
      .filter((p) => ![...opPins.values()].some((o) => o.error.id === p.error.id))
    const ctx: ErrorContext = {
      from: result.from,
      intent: desc.policy.intent.parse(store.getSnapshot().pendingIntent ?? 'submit').action,
      outcome: result.outcome,
    }
    const shown = display(result.errors, ctx)
    store.set((s) => ({
      ...s,
      status: result.outcome === 'queued' ? 'queued' : result.ok ? 'success' : 'error',
      pending: false, pendingIntent: undefined,
      result, outcome: result.outcome,
      facts: result.errors, shown: shown.errors, removed: shown.removed,
      values: { ...s.values, ...result.values },
      revision: result.revision,
    }))
    // Q1: сообщаем ПОСЛЕ применения — показ не зависит от sink'а; дедуп по submissionId.
    if (notify) notified = notifyResultErrors(o.onError ?? cfg.config.onError, result, notified)
  }

  /**
   * Продолжение — адресованное сообщение: чужое не применяется, иначе две
   * одинаковые формы увидят чужие ошибки.
   */
  let notified: string | undefined
  let lifted: Result | null | undefined
  function lift(result: Result | null | undefined) {
    if (!result || result === lifted) return
    if (result.formId !== desc.id || result.instance !== instance) return
    lifted = result
    // окончательный итог (без JS, опрос очереди) — следующая отправка с новым id
    submissionId = isSettled(result) ? crypto.randomUUID() : result.submissionId
    applyResult(result)
  }

  function recheck(name: string) {
    if (!formEl) return
    const ev = evaluate(new FormData(formEl), desc, { render, instance, requireEnvelope: false })
    const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
    const shown = display(ev.errors, ctx)
    // закреплённые серверные ошибки решает syncPins по значению, а не уход с поля
    // подпути вложенного поля (`props.s1.label`) перепроверяются вместе с ним
    const own = (e: FormError) => e.path === name || !!e.path?.startsWith(`${name}.`)
    const keep = (e: FormError) => !own(e) || pinned(e)
    store.set((s) => ({
      ...s,
      facts: [...s.facts.filter(keep), ...ev.errors.filter(own)],
      shown: [...s.shown.filter(keep), ...shown.errors.filter(own)],
    }))
    syncPins()
  }

  // серверная ошибка поля закреплена за отправленным значением (../pins);
  // ошибки операций перехватчиков живут рядом своими закрепами и переживают
  // применение результатов (сервер их не воспроизводит и не снимает)
  let pins: Pin[] = []
  const opPins = new Map<string, Pin>()
  const pinsNow = (): Pin[] => [...pins, ...opPins.values()]
  const pinned = (e: FormError) => isPinned(pinsNow(), e)

  function syncPins() {
    const all = pinsNow()
    if (!formEl || !all.length) return
    const s = store.getSnapshot()
    const facts = reconcilePins(all, s.facts, new FormData(formEl))
    if (!facts) return
    const ctx: ErrorContext = {
      from: s.result?.from ?? 'fetch',
      intent: desc.policy.intent.parse(s.pendingIntent ?? 'submit').action,
      outcome: s.result?.outcome ?? s.outcome ?? 'not-applied',
    }
    const shown = display(facts, ctx)
    store.set((cur) => ({ ...cur, facts, shown: shown.errors, removed: shown.removed }))
  }

  /* ── перехваты полей (Field takeover) ── */

  // последнее присвоенное `f.error` по полю: чтение ручки симметрично
  // записи; показ и блокировку решают opPins по значению носителя
  const opErrorInputs = new Map<string, OpErrorInput>()

  /** Ошибка операции поля: закреп за текущим значением носителя (pins). */
  function setFieldError(name: string, err: OpErrorInput | null) {
    const prev = opPins.get(name)
    opPins.delete(name)
    if (prev)
      store.set((s) => ({
        ...s,
        facts: s.facts.filter((e) => e.id !== prev.error.id),
        shown: s.shown.filter((e) => e.id !== prev.error.id),
      }))
    if (!err) { opErrorInputs.delete(name); return }
    opErrorInputs.set(name, err)
    const error = opError(name, err, render, desc.policy.limits)
    if (!error) return
    opPins.set(name, opPin(name, error, formEl ? new FormData(formEl) : undefined))
    const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
    store.set((s) => {
      const facts = [...s.facts.filter((e) => e.id !== error.id), error]
      return { ...s, facts, shown: display(facts, ctx).errors }
    })
  }

  // подготовка значений в полёте по полям: submit ждёт текущие `f.pending`
  const pendings = new Map<string, Promise<unknown>>()
  function setPending(name: string, p: Promise<unknown> | undefined) {
    if (!p) { pendings.delete(name); return }
    const tracked = Promise.resolve(p).catch(() => undefined)
    pendings.set(name, tracked)
    void tracked.finally(() => { if (pendings.get(name) === tracked) pendings.delete(name) })
  }
  async function settlePendings() {
    // за время ожидания перехватчик мог задать следующее `pending`
    while (pendings.size) await Promise.allSettled([...pendings.values()])
  }

  /**
   * Живая ручка поля: тот же прокси-приём, что у `f` связки — каждое чтение
   * идёт в свежий `viewOf`, ручка не устаревает. Запись — только свойства
   * `error`/`pending`; остальное в `FieldView` readonly и по типу. Одна
   * ручка на поле (кэш): идентичность стабильна для перехватчика.
   */
  const handles = new Map<string, FieldHandle>()
  function handleOf(f: FieldDescriptor): FieldHandle {
    const cached = handles.get(f.name)
    if (cached) return cached
    const handle = new Proxy({}, {
      get: (_t, k: string | symbol) => {
        if (k === 'error') return opErrorInputs.get(f.name)
        if (k === 'pending') return pendings.get(f.name)
        return (viewOf(f) as unknown as Record<string | symbol, unknown>)[k]
      },
      set: (_t, k: string | symbol, v: unknown) => {
        if (k === 'error') { setFieldError(f.name, (v as OpErrorInput | undefined) ?? null); return true }
        if (k === 'pending') { setPending(f.name, v as Promise<unknown> | undefined); return true }
        return false
      },
      has: (_t, k: string) => k === 'error' || k === 'pending' || k in viewOf(f),
      ownKeys: () => [...Object.keys(viewOf(f)), 'error', 'pending'],
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    }) as unknown as FieldHandle
    handles.set(f.name, handle)
    return handle
  }

  /**
   * Асинхронная проверка — оптимизация, а не отдельная возможность:
   * на сервере те же проверки выполняются всегда. Отправку она не блокирует.
   */
  function scheduleCheck(name: string) {
    if (!runner || !formEl) return
    // у поля может не быть асинхронных проверок — тогда и признака быть не должно,
    // иначе он останется поднятым навсегда
    if (!asyncRefsOf(desc, name).length) return
    store.set((s) => ({ ...s, checking: { ...s.checking, [name]: true } }))
    runner.schedule(desc, name, valuesForChecks(new FormData(formEl), desc), (raw) => {
      store.set((s) => {
        const checking = { ...s.checking }
        delete checking[name]
        // Асинхронный ответ заменяет только предыдущую async-ошибку.
        // Синхронные ошибки того же поля (email/minLength/…) сохраняются.
        const previous = asyncErrorIds.get(name)
        // Текст — тем же словарём, что у синхронных ошибок и у сервера (F57):
        // без этого живая проверка показывала код вместо текста.
        const error = raw && normalizeErrors([raw], render, desc.policy.limits)[0]
        const facts = s.facts.filter((e) => e.id !== previous && e.id !== error?.id)
        if (error) { facts.push(error); asyncErrorIds.set(name, error.id) }
        else asyncErrorIds.delete(name)
        const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
        return { ...s, checking, facts, shown: display(facts, ctx).errors }
      })
    })
  }


  /** Собрать набор объявленных ключей из DOM и отдать sink'у хоста. */
  // Дубль-страх sink'а: blur-овый `change` приходит и когда значение не
  // менялось с прошлого коммита (дебаунс-коммит уже был). Повтор того же
  // патча — шум, который на смене монти (remont хоста) успевает приземлиться
  // в НОВОЕ хранилище чужим значением. Тот же патч, что уже отправляли, — мимо.
  let lastUrlPatch: string | null = null

  /** Набор объявленных ключей из DOM: проверка `evaluate` + патч без выключенных. */
  function readUrl(form: HTMLFormElement) {
    const ev = evaluate(new FormData(form), desc, { render, instance, requireEnvelope: false })
    const patch: Record<string, unknown> = {}
    for (const f of desc.fields) {
      // Выключенный контрол в набор не кладём: FormData его не несёт, а отсутствие
      // записи декодер честно читает как default — full-set-коммит живого режима
      // стёр бы хранимое значение. Политика домена (§6.4): значение живёт в форме,
      // из набора его вырезает связка. Снимут блокирующее — поле вернётся со значением.
      const ctl = form.querySelectorAll(`[name="${CSS.escape(f.name)}"]`)
      if (ctl.length > 0 && Array.from(ctl).every((el) => (el as HTMLInputElement).disabled)) continue
      patch[f.name] = ev.values[f.name]
    }
    return { ev, patch }
  }

  /**
   * Зеркало без коммита (`live: false`) для канала `fieldState` (C6/F44): тот
   * же DOM, что у коммита. Только `change`: на `input` промежуточный `7.` в
   * number читается пустым и стёр бы набираемое.
   */
  function mirrorUrl() {
    if (!formEl) return
    const { patch } = readUrl(formEl)
    store.set((st) => ({ ...st, values: { ...st.values, ...patch } }))
  }

  function commitUrl(via: UrlCommitVia, name?: string) {
    const url = o.url
    if (!url || !formEl) return
    const { ev, patch } = readUrl(formEl)
    const printed = JSON.stringify(patch)
    if (printed === lastUrlPatch) {
      if (name) recheck(name)
      return
    }
    lastUrlPatch = printed
    url.commit(patch, via)
    // локальное зеркало держим в такт с DOM: подсветка/живые проверки читают state
    store.set((st) => ({ ...st, values: { ...st.values, ...patch } }))
    // Коммит-набор (без имени поля) показывает ИТОГ проверки целиком: форма
    // фильтров узнаёт нарушения связок на месте, до похода на сервер.
    if (name) recheck(name)
    else
      store.set((s) => ({
        ...s,
        facts: ev.errors,
        shown: display(ev.errors, { from: 'fetch', intent: 'submit', outcome: 'not-applied' }).errors,
      }))
  }

  function formProps(): FormProps {
    const url = o.url
    if (url) {
      return {
        method: 'get',
        action: url.action ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
        onsubmit: (e: SubmitEvent) => {
          if (!hydrated) return                       // нативный GET до оживления (и без JS)
          e.preventDefault()
          commitUrl('submit')
        },
        [ATTACH]: (el: Element) => {
          const form = el as HTMLFormElement
          formEl = form
          // ATTACH значит «мы живые»: novalidate — браузеру тут делать нечего,
          // конверт не нужен (hidden() пуст), envelope-проверка не звенит.
          form.setAttribute('novalidate', '')
          assertPlacement(form)
          // `live: false` — форма коммит-набора: применяет submit (или commit()
          // хоста), `change` лишь обновляет зеркало.
          const live = (ev: Event) => {
            const t = ev.target as HTMLElement | null
            const fname = t && 'name' in t ? String((t as HTMLInputElement).name) : ''
            if (fname) commitUrl('field', fname)
          }
          const onChange = url.live !== false ? live : mirrorUrl
          form.addEventListener('change', onChange)
          return () => {
            form.removeEventListener('change', onChange)
            if (formEl === form) formEl = null
          }
        },
        ...(snapshot.pending ? { 'aria-busy': true as const } : {}),
      }
    }
    return {
      method: 'post',
      action: resolveAction(),
      enctype: 'multipart/form-data',
      onsubmit: (e: SubmitEvent) => {
        if (!(o.intercept ?? true)) return            // отдаём браузеру нативный путь
        e.preventDefault()
        const el = e.currentTarget as HTMLFormElement
        const submitter = (e as SubmitEvent & { submitter?: HTMLElement }).submitter
        // второй аргумент: намерение приходит тем же ключом, что и нативно
        void submit(new FormData(el, submitter as HTMLButtonElement | null))
      },
      [ATTACH]: (el: Element) => {
        const form = el as HTMLFormElement
        formEl = form
        // novalidate ставится атрибутом ПОСЛЕ отрисовки, а не пропсом: иначе
        // сервер отдаст дерево без атрибута, клиент с ним — рассинхрон оживления
        if (o.intercept ?? true) form.setAttribute('novalidate', '')
        else form.removeAttribute('novalidate')
        assertEnvelope(form)
        syncPins() // снять значения для ошибок продолжения; сверку ведёт onInput (см. ../pins)
        return () => { if (formEl === form) formEl = null }
      },
      ...(snapshot.pending ? { 'aria-busy': true as const } : {}),
    }
  }

  // S3: неразмещённое поле (url-режим: поле обязано быть в разметке, конверта нет).
  // Семья «разметка приложения»: DEV console.error с перечислением и подсказкой.
  function assertPlacement(el: HTMLFormElement) {
    if (!DEV) return
    const missing = desc.fields
      .filter((f) => !el.querySelector(`[name="${f.name}"]`))
      .map((f) => f.name)
    if (missing.length)
      console.error(
        `[form] форма '${desc.id}': в разметке нет полей: ${missing.join(', ')}. ` +
        'Разместите каждое поле field(name) или уберите его из описания.')
  }

  function assertEnvelope(el: HTMLFormElement) {
    if (!DEV) return
    const missing = hidden().map((h) => h.name)
      .filter((n) => !el.querySelector(`input[name="${n}"]`))
    if (missing.length)
      console.error(
        `[form] форма '${desc.id}': в разметке нет полей конверта: ${missing.join(', ')}. ` +
        'Разверните form.hidden() внутри элемента формы.')
  }

  function hidden(): HiddenProps[] {
    // URL-режим: конверт не участвует — ни в DOM, ни в адрес (иначе __form_*
    // уехали бы GET-ом мусор-параметрами).
    if (o.url) return []
    const env = buildEnvelope({
      formId: desc.id, revision: desc.revision, instance, submissionId, specVersion: o.specVersion,
    }, desc.policy)
    return Object.entries(env).map(([name, value]) =>
      ({ type: 'hidden' as const, name, value, readonly: true as const }))
  }

  function intent(id: string): IntentProps {
    const descriptor = desc.actions.find((a) => a.id === desc.policy.intent.parse(id).action)
    return {
      name: desc.policy.envelopeKeys.intent, value: id,
      // Браузер проверяет ВСЕ поля по атрибутам: действие, которое проверяет не всё
      // (без проверки, без обязательности, часть полей), он заблокировал бы без JS.
      ...(descriptor && (descriptor.validate !== 'full' || descriptor.relax?.length || descriptor.subset)
        ? { formnovalidate: true } : {}),
      ...(snapshot.pending ? { disabled: true } : {}),
      ...(snapshot.pending && snapshot.pendingIntent === id ? { 'aria-busy': true as const } : {}),
    }
  }

  const byField = $derived(split(snapshot.shown).byField)

  function viewOf(f: FieldDescriptor): FieldView {
    const id = cfg.ui.fieldId(desc.id, f.name)
    // у вложенного поля (`field.fields`) ошибки и на подпутях: `props.s1.max_length`
    const unordered = desc.registry.types.get(f.kind).nested
      ? Object.entries(byField).filter(([p]) => p === f.name || p.startsWith(`${f.name}.`)).flatMap(([, e]) => e)
      : byField[f.name] ?? []
    // собственная проверка поля сильнее ошибки операции перехватчика:
    // она — последней в списке поля (показ читает список с начала)
    const opId = opPins.get(f.name)?.error.id
    const errors = opId && unordered.length > 1
      ? [...unordered.filter((e) => e.id !== opId), ...unordered.filter((e) => e.id === opId)]
      : unordered
    const value = snapshot.values[f.name]
    const helpId = `${id}-help`
    const errorId = `${id}-error`
    const noteId = `${id}-note`
    const note = snapshot.result?.notes?.[f.name]
    const has = hasError(f.name, snapshot.facts, snapshot.shown, invalidMode(f.name))
    // Канал fieldState → правила disabledWhen → объявление (инвариант — в fieldLinkState).
    const ls = fieldLinkState(f, o.fieldState?.(f.name, snapshot.values) ?? disabledState(desc, f, snapshot.values, render))
    const describedBy = cfg.ui.describedBy({
      help: f.help || ls.reason ? helpId : undefined,
      error: errors.length ? errorId : undefined,
      note: note && noteId,
    })

    const base = desc.attrsOf(f.name)
    const attrs: HtmlAttrs = {
      ...base.attrs, name: f.name, id,
      // список смонтированных полей собирает адаптер
      [ATTACH]: () => undefined,
    }
    if (ls.disabled) attrs.disabled = true
    if (has) attrs['aria-invalid'] = true
    if (errors.length) attrs['aria-errormessage'] = errorId
    if (describedBy) attrs['aria-describedby'] = describedBy
    Object.assign(attrs, cfg.ui.valueAttrs(f, value))

    const view: FieldView = {
      name: f.name, input: f.input, kind: f.kind,
      attrs, skipped: base.skipped,
      label: f.label, help: f.help, placeholder: f.placeholder, variant: f.variant, options: f.options,
      errors, value, has,
      ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
      ...(f.fieldSet ? { fieldSet: f.fieldSet } : {}),
      disabled: ls.disabled, reason: ls.reason, note,
      touched: snapshot.touched[f.name] === true,
      dirty: snapshot.dirty[f.name] === true,
      checking: snapshot.checking[f.name] === true,
      labelProps: () => ({ for: id }),
      helpProps: () => (f.help || ls.reason ? { id: helpId } : undefined),
      errorProps: () => (errors.length ? { id: errorId, role: 'alert' as const } : undefined),
      noteProps: () => (note ? { id: noteId } : undefined),
      setTouched: (val = true) => {
        store.set((s) => ({ ...s, touched: { ...s.touched, [f.name]: val } }))
        if (cfg.ui.shouldValidate({ event: 'blur', name: f.name, live: liveMode(),
                                    state: store.getSnapshot() })) recheck(f.name)
      },
      onInput: (raw) => {
        store.set((s) => ({
          ...s,
          values: { ...s.values, [f.name]: raw },
          dirty: { ...s.dirty, [f.name]: true },
        }))
        if (cfg.ui.shouldValidate({ event: 'input', name: f.name, live: liveMode(),
                                    state: store.getSnapshot() })) recheck(f.name)
        else syncPins() // recheck вызывает её сам
        scheduleCheck(f.name)
      },
    }
    // живая ручка для Field takeover: неперечисляемый символ — в спред
    // пропсов компонентов полей не попадает, снимок остальным не меняется
    Object.defineProperty(view, FIELD_HANDLE, { value: handleOf(f) })
    return view
  }

  // продолжение поднимается ДО первой отрисовки: страница отдаётся уже
  // с ошибками на местах, а не мигает пустой
  lift(o.continuation)

  const fieldProxy = new Proxy({} as Record<string, FieldView>, {
    get: (_t, name: string) => {
      const f = desc.byName[name]
      return f ? viewOf(f) : undefined
    },
    has: (_t, name: string) => name in desc.byName,
    ownKeys: () => desc.fields.map((f) => f.name),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })

  /**
   * Отправка через перехват: конверт → локальная проверка тем же `evaluate`
   * → транспорт → применение результата. Устаревшая отправка отбрасывается.
   * @param data Данные формы с намерением.
   */
  async function submit(data: FormData): Promise<Result | undefined> {
    const raw = String(data.get(desc.policy.envelopeKeys.intent) ?? 'submit')
    const begun = await machine.acquire(desc.revision, raw, submissionId)
    if (!begun.go) return undefined

    store.set((s) => ({
      ...s, status: 'submitting', pending: true, pendingIntent: raw, progress: undefined,
      submitCount: s.submitCount + 1,
    }))

    // ожидание перехватчиков: дождаться готовящихся значений и перечитать
    // DOM — правда отправки там (носитель мог получить значение только что)
    if (pendings.size) {
      await settlePendings()
      if (formEl) {
        const fresh = new FormData(formEl)
        const intentKey = desc.policy.envelopeKeys.intent
        if (!fresh.has(intentKey) && data.has(intentKey))
          fresh.set(intentKey, String(data.get(intentKey)))
        data = fresh
      }
    }

    // видимые ошибки операций блокируют отправку локально, как проверка в
    // runSubmit; серверный evaluate их не знает и не воспроизводит
    const descriptor = desc.actions.find((a) => a.id === desc.policy.intent.parse(raw).action) ?? desc.actions[0]
    const opErrors = blockingOpErrors(opPins.values(), data, descriptor)
    if (opErrors.length) {
      const ev = evaluate(data, desc, { render, instance, requireEnvelope: false })
      const blocked: Result = {
        v: 1, formId: desc.id, instance, submissionId: begun.submission.id,
        revision: desc.revision, ok: false, intent: raw,
        status: desc.policy.status.validationFailed, outcome: 'not-applied',
        errors: normalizeErrors([...ev.errors, ...opErrors], render, desc.policy.limits),
        values: ev.publicValues, from: 'fetch',
      }
      machine.finish(begun.submission)
      applyResult(blocked, data, false)
      return blocked
    }

    const result = await runSubmit({
      description: desc, data, instance, intent: raw,
      submission: begun.submission,
      transport: o.transport ?? cfg.config.transport ?? notConfigured,
      render,
      // ход пишет только живая отправка: устаревшая чужое состояние не трогает
      report: (progress) => {
        if (!machine.stale(begun.submission, desc.revision)) store.set((s) => ({ ...s, progress }))
      },
    })

    // сверка актуальности ДО освобождения машины: после finish текущая отправка
    // уже не она, и проверка всегда давала бы «устарела»
    const stale = machine.stale(begun.submission, desc.revision)
    machine.finish(begun.submission)
    if (stale) return result
    store.set((s) => (s.progress === undefined ? s : { ...s, progress: undefined }))

    applyResult(result, data)
    // один id — одна логическая отправка (`isSettled`)
    if (isSettled(result)) submissionId = crypto.randomUUID()
    return result
  }

  return {
    description: desc,
    instance,
    get state() { return snapshot },
    get values() { return snapshot.values },
    /** Общие ошибки: у них нет пути. */
    get common() { return split(snapshot.shown).common },
    get facts() { return snapshot.facts },
    get shown() { return snapshot.shown },
    get submitVisible() { return !hydrated },
    formProps, hidden, intent, submit, lift, redisplay,
    /**
     * Поля сохранённого набора (`defineForm({ from })`) в его порядке: `item` — поле
     * схемы (вид `preset`, подпись, правила), `f` — вид поля. Цикл и обёртку пишет разметка.
     */
    from: () => desc.fields.filter((f) => f.spec).map((f) => ({ item: f.spec!, f: viewOf(f) })),
    get f() { return fieldProxy },
    field: (name: string) => (desc.byName[name] ? viewOf(desc.byName[name]!) : undefined),
    /** S5 (url-канал): коммит текущего состояния формы в sink хоста, как если бы
     * поле изменили нативно — для управляемого хостом ввода (debounce, кнопки). */
    commit: (name?: string) => commitUrl('field', name),
    select: <T,>(sel: (s: FormState) => T) => sel(snapshot),
  }
}

export type BoundForm = ReturnType<typeof bind>

const notConfigured: Transport = async () =>
  ({ kind: 'network', code: 'network.failed', detail: 'транспорт не настроен' })
