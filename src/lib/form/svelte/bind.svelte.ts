// Слой Svelte: единственное место, где ядро встречается с реактивностью.
//
// Библиотека не создаёт ни одного элемента: всё ниже — наборы пропсов.
import { createAttachmentKey } from 'svelte/attachments'
import { AsyncRunner, asyncRefsOf, type CheckRegistry } from '../async'
import type { ConstraintKind } from '../constraints'
import { applyOps, editor, groupRows, reconcile, type SchemaOp } from '../editor'
import type { FieldDescriptor, FormDescription, InvalidFrom } from '../describe'
import { applyHandler, hasError, invalidFromFor, split, type ErrorContext, type ErrorHandler } from '../errors'
import { buildEnvelope } from '../envelope'
import { makeRenderer, ru } from '../messages'
import type { FormError, Result } from '../result'
import { FormStore, initialState, type FormState } from '../state'
import { evaluate, runSubmit, SubmitMachine, type Transport } from '../submit'
import type { HtmlAttrs, RowKey } from '../types'
import type { BoundConfig, LiveMode } from './config'

/**
 * Привязка к узлу едет ВНУТРИ набора пропсов — как `ref` в других движках.
 * Приложение разворачивает `{...attrs}` и этим регистрирует поле; забыть
 * регистрацию нельзя, потому что забывать нечего.
 */
const ATTACH = createAttachmentKey()

export interface FormProps {
  method: 'post'
  action: string
  enctype: 'multipart/form-data'
  onsubmit: (e: SubmitEvent) => void
  'aria-busy'?: true
  [key: symbol]: unknown
}

export interface HiddenProps { type: 'hidden'; name: string; value: string; readonly: true }

export interface IntentProps {
  name: string
  value: string
  formnovalidate?: boolean
  disabled?: boolean
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
  readonly options?: readonly { value: string; label: string; disabled?: boolean }[]
  /** Тексты: то, что вернул обработчик. Может быть пусто при невалидном поле. */
  readonly errors: readonly FormError[]

  readonly value: unknown
  /** Факт невалидности. Источник настраивается: по факту или по показу. */
  readonly has: boolean
  readonly touched: boolean
  readonly dirty: boolean
  readonly fresh: boolean
  /** Идёт асинхронная проверка. */
  readonly checking: boolean

  labelProps(): { for: string }
  helpProps(): { id: string } | undefined
  errorProps(): { id: string; role: 'alert' } | undefined

  setTouched(v?: boolean): void
  onInput(raw: unknown): void
}

/** Настройка связывания: перекрывает проектную конфигурацию. */
export interface BindOptions {
  /** Адрес нативной отправки. По умолчанию — `actionBase/id`. */
  action?: string
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
  /** Источник подсветки: по факту или по показу. */
  invalidFrom?: InvalidFrom
  /** Асинхронные проверки. На сервере те же выполняются всегда. */
  checks?: CheckRegistry
}

/** Повторяемая группа: ключи стабильны, индекс — производное. */
export interface RowsView {
  readonly keys: readonly RowKey[]
  row(key: RowKey): readonly FieldView[]
  add(): IntentProps
  remove(key: RowKey): IntentProps
  move(key: RowKey, dir: 'up' | 'down'): IntentProps
  rowProps(key: RowKey): { 'data-row': string }
}

/**
 * Связать описание формы с реактивностью Svelte.
 * @param cfg Настройка проекта из `createConfig`.
 * @param initial Описание формы.
 * @param o Перекрытия для этой формы.
 * @returns Связка: состояние, поля, отправка, операции над набором.
 */
export function bind(cfg: BoundConfig, initial: FormDescription, o: BindOptions = {}) {
  // описание изменяемо: операции над набором полей строят НОВОЕ описание
  let desc = $state.raw<FormDescription>(initial)
  
  const instance = o.instance ?? `${initial.id}:new`
  const action = o.action ?? `${cfg.config.actionBase ?? ''}/${initial.id}`
  const render = makeRenderer([cfg.config.messages, initial.messages as never, ru],
                              initial.policy.interpolate)
  const runner = o.checks ? new AsyncRunner(o.checks) : undefined

  // начальное состояние — из начального описания: локальное чтение $state.raw
  // захватывает только начальное значение (предупреждение компилятора)
  const store = new FormStore(initialState(initial.revision))
  const machine = new SubmitMachine(cfg.config.parallel ?? 'block')

  let submissionId = o.submissionId ?? crypto.randomUUID()
  let snapshot = $state.raw<FormState>(store.getSnapshot())
  store.subscribe(() => { snapshot = store.getSnapshot() })

  let formEl: HTMLFormElement | null = null

  const handler = () => o.onErrors ?? cfg.config.onErrors
  const liveMode = () => o.live ?? cfg.config.live ?? 'after-touched'
  const invalidMode = (name: string): InvalidFrom =>
    o.invalidFrom ?? invalidFromFor(name, desc, cfg.config.invalidFrom ?? 'fact')

  /** Факты в показ: один обработчик, оба пути. */
  function display(facts: readonly FormError[], ctx: ErrorContext) {
    const shown = applyHandler(facts, ctx, handler())
    if (import.meta.env.DEV && shown.removed > 0)
      console.warn(`[form] обработчик убрал ${shown.removed} из ${facts.length} ошибок`)
    return shown
  }

  /** Повторно применить текущий обработчик к сохранённым фактам.
   * Полезно для интерактивных настроек демо и devtools: сеть и валидация
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

  function applyResult(result: Result) {
    const ctx: ErrorContext = {
      from: result.from,
      intent: desc.policy.intent.parse(store.getSnapshot().pendingIntent ?? 'submit').action,
      outcome: result.outcome,
    }
    const shown = display(result.errors, ctx)
    store.set((s) => ({
      ...s,
      status: result.ok ? 'success' : result.outcome === 'queued' ? 'queued' : 'error',
      pending: false, pendingIntent: undefined,
      result, outcome: result.outcome,
      facts: result.errors, shown: shown.errors, removed: shown.removed,
      values: { ...s.values, ...result.values },
      revision: result.revision,
    }))
  }

  /**
   * Продолжение — адресованное сообщение: чужое не применяется, иначе две
   * одинаковые формы увидят чужие ошибки.
   */
  let lifted: Result | null | undefined
  function lift(result: Result | null | undefined) {
    if (!result || result === lifted) return
    if (result.formId !== desc.id || result.instance !== instance) return
    lifted = result
    submissionId = result.submissionId
    applyResult(result)
  }

  function recheck(name: string) {
    if (!formEl) return
    const ev = evaluate(new FormData(formEl), desc, { render, instance, requireEnvelope: false })
    const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
    const shown = display(ev.errors, ctx)
    store.set((s) => ({
      ...s,
      facts: [...s.facts.filter((e) => e.path !== name), ...ev.errors.filter((e) => e.path === name)],
      shown: [...s.shown.filter((e) => e.path !== name), ...shown.errors.filter((e) => e.path === name)],
    }))
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
    runner.schedule(desc, name, Object.fromEntries(new FormData(formEl).entries()), (error) => {
      store.set((s) => {
        const checking = { ...s.checking }
        delete checking[name]
        const facts = [...s.facts.filter((e) => e.path !== name), ...(error ? [error] : [])]
        const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
        return { ...s, checking, facts, shown: display(facts, ctx).errors }
      })
    })
  }

  /* ── изменение набора полей ─────────────────────────────────────── */

  /**
   * Операция — данные: та же `applyOps` применяется на сервере при нативной
   * отправке. Состояние переносится одним проходом, ошибки менявшихся полей
   * сбрасываются.
   */
  function apply(ops: readonly SchemaOp[]): FormDescription {
    const before = desc
    const next = applyOps(before, ops)
    const moved = reconcile(next, before, {
      values: store.getSnapshot().values,
      facts: store.getSnapshot().facts,
      dirty: store.getSnapshot().dirty,
      touched: store.getSnapshot().touched,
    })
    desc = next
    const fresh: Record<string, true> = {}
    for (const f of next.fields) if (f.fresh) fresh[f.name] = true
    store.set((s) => ({
      ...s, revision: next.revision, values: moved.values, facts: moved.facts,
      dirty: moved.dirty, touched: moved.touched, fresh,
      shown: display(moved.facts, { from: 'fetch', intent: 'submit', outcome: 'not-applied' }).errors,
    }))
    return next
  }

  function rows(group: string): RowsView {
    const keys = groupRows(desc.fields)[group] ?? []
    const i = (action: string, arg?: string) => intent(desc.policy.intent.format(action, arg))
    return {
      keys,
      row: (key) => desc.fields
        .filter((f) => f.name.startsWith(`${group}.${key}.`))
        .map((f) => viewOf(f)),
      add: () => i('add-row', group),
      remove: (key) => i('remove-row', `${group}:${key}`),
      move: (key, dir) => i('move-row', `${group}:${key}:${dir}`),
      rowProps: (key) => ({ 'data-row': key }),
    }
  }

  function formProps(): FormProps {
    return {
      method: 'post',
      action,
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
        return () => { if (formEl === form) formEl = null }
      },
      ...(snapshot.pending ? { 'aria-busy': true as const } : {}),
    }
  }

  function assertEnvelope(el: HTMLFormElement) {
    if (!import.meta.env.DEV) return
    const missing = hidden().map((h) => h.name)
      .filter((n) => !el.querySelector(`input[name="${n}"]`))
    if (missing.length)
      console.error(
        `[form] форма '${desc.id}': в разметке нет полей конверта: ${missing.join(', ')}. ` +
        'Разверните form.hidden() внутри элемента формы.')
  }

  function hidden(): HiddenProps[] {
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
      ...(descriptor?.validate === 'none' ? { formnovalidate: true } : {}),
      ...(snapshot.pending ? { disabled: true, 'aria-busy': true as const } : {}),
    }
  }

  const byField = $derived(split(snapshot.shown).byField)

  function viewOf(f: FieldDescriptor): FieldView {
    const id = cfg.ui.fieldId(desc.id, f.name)
    const errors = byField[f.name] ?? []
    const value = snapshot.values[f.name]
    const helpId = `${id}-help`
    const errorId = `${id}-error`
    const has = hasError(f.name, snapshot.facts, snapshot.shown, invalidMode(f.name))
    const describedBy = cfg.ui.describedBy({
      help: f.help ? helpId : undefined,
      error: errors.length ? errorId : undefined,
    })

    const base = desc.attrsOf(f.name)
    const attrs: HtmlAttrs = {
      ...base.attrs, name: f.name, id,
      // список смонтированных полей собирает адаптер
      [ATTACH]: () => undefined,
    }
    if (has) attrs['aria-invalid'] = true
    if (errors.length) attrs['aria-errormessage'] = errorId
    if (describedBy) attrs['aria-describedby'] = describedBy
    Object.assign(attrs, cfg.ui.valueAttrs(f, value))

    return {
      name: f.name, input: f.input, kind: f.kind,
      attrs, skipped: base.skipped,
      label: f.label, help: f.help, placeholder: f.placeholder, options: f.options,
      errors, value, has,
      touched: snapshot.touched[f.name] === true,
      dirty: snapshot.dirty[f.name] === true,
      fresh: snapshot.fresh[f.name] === true,
      checking: snapshot.checking[f.name] === true,
      labelProps: () => ({ for: id }),
      helpProps: () => (f.help ? { id: helpId } : undefined),
      errorProps: () => (errors.length ? { id: errorId, role: 'alert' as const } : undefined),
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
        scheduleCheck(f.name)
      },
    }
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
      ...s, status: 'submitting', pending: true, pendingIntent: raw,
      submitCount: s.submitCount + 1,
    }))

    const result = await runSubmit({
      description: desc, data, instance, intent: raw,
      submission: begun.submission,
      transport: o.transport ?? cfg.config.transport ?? notConfigured,
      render,
    })

    // сверка актуальности ДО освобождения машины: после finish текущая отправка
    // уже не она, и проверка всегда давала бы «устарела»
    const stale = machine.stale(begun.submission, desc.revision)
    machine.finish(begun.submission)
    if (stale) return result

    applyResult(result)
    // Один id защищает только одну логическую отправку. После окончательного
    // исхода следующая отправка должна получить новый id, иначе сервер вернёт
    // кэш предыдущей операции.
    if (result.outcome === 'committed' || result.outcome === 'unknown')
      submissionId = crypto.randomUUID()
    return result
  }

  return {
    // геттер: apply() строит новое описание, связка отдаёт актуальное
    get description() { return desc },
    instance,
    get state() { return snapshot },
    get values() { return snapshot.values },
    /** Общие ошибки: у них нет пути. */
    get common() { return split(snapshot.shown).common },
    get facts() { return snapshot.facts },
    get shown() { return snapshot.shown },
    formProps, hidden, intent, submit, lift, redisplay, apply, rows,
    /** Поля, созданные в рантайме: отличаются только префиксом имени. */
    custom: (prefix = 'u_') => desc.fields.filter((f) => f.name.startsWith(prefix)).map(viewOf),
    get f() { return fieldProxy },
    field: (name: string) => (desc.byName[name] ? viewOf(desc.byName[name]!) : undefined),
    select: <T,>(sel: (s: FormState) => T) => sel(snapshot),
  }
}

export type BoundForm = ReturnType<typeof bind>

const notConfigured: Transport = async () =>
  ({ kind: 'network', code: 'network.failed', detail: 'транспорт не настроен' })
