// Слой Solid: единственное место, где ядро встречается с реактивностью.
//
// Библиотека не создаёт ни одного элемента: всё ниже — наборы пропсов.
// Контракт повторяет svelte-бинд поле в поле: formProps()/hidden() — функции,
// `form.f.email` — прокси полей, rows() — повторяемые группы, FieldView —
// данные поля с attrs/aria-пропсами.
//
//   createSignal + FormStore        — состояние (снапшоты по ссылке)
//   evaluate()                       — та же проверка, что на сервере
//   runSubmit + SubmitMachine        — конвейер и гонки
//   applyHandler/split/hasError      — факт/показ
//   AsyncRunner                      — асинхронные проверки
//   applyOps/reconcile               — операции над набором полей
//
// Компонент Solid живёт один раз, поэтому связка создаётся один раз, а
// настройки читаются ЛЕНИВО: колбэки держат объект опций с геттерами.
import { AsyncRunner, asyncRefsOf, type CheckRegistry } from '../async'
import type { ConstraintKind } from '../constraints'
import { applyOps, editor, groupRows, reconcile, type SchemaOp } from '../editor'
import type { FieldDescriptor, FormDescription, InvalidFrom } from '../describe'
import { applyHandler, hasError, invalidFromFor, split, type ErrorContext, type ErrorHandler } from '../errors'
import { buildEnvelope } from '../envelope'
import { makeRenderer, ru } from '../messages'
import type { FormError, Result } from '../result'
import { FormStore, initialState } from '../state'
import { evaluate, runSubmit, SubmitMachine, type ParallelPolicy, type Transport } from '../submit'
import type { HtmlAttrs, RowKey } from '../types'
import { batch, createSignal } from 'solid-js'
import type { BoundConfig, LiveMode, UiPolicy } from './config'

/** Настройки связки: адрес, режимы и колбэки конкретной формы. */
export interface CreateFormOptions {
  /** Адрес нативной отправки. По умолчанию — `/api/form`. */
  action?: string
  instance?: string
  /** Накопленное после нативной отправки: поднимается при создании связки. */
  continuation?: Result | null
  /** Перехватывать отправку. `false` — обычный POST браузером. */
  intercept?: boolean
  live?: LiveMode
  transport?: Transport
  /** Политика параллельных отправок; читается перед каждой отправкой. */
  parallel?: ParallelPolicy
  onErrors?: ErrorHandler
  invalidFrom?: InvalidFrom
  checks?: CheckRegistry
  /** Версия спецификации в конверте: сервер поднимает описание по ней. */
  specVersion?: number
}

/** Данные одного поля: `attrs` содержит всё, что обязано быть на элементе. */
export interface FieldView {
  readonly name: string
  readonly input: FieldDescriptor['input']
  readonly kind: FieldDescriptor['kind']
  readonly attrs: HtmlAttrs
  readonly skipped: readonly { kind: ConstraintKind; why: string }[]
  readonly label?: string
  readonly help?: string
  readonly placeholder?: string
  /** Варианты выбора: у селектов ограничение живёт в самих вариантах. */
  readonly options?: readonly { value: string; label: string; disabled?: boolean }[]
  readonly errors: readonly FormError[]
  readonly value: unknown
  readonly has: boolean
  readonly touched: boolean
  readonly dirty: boolean
  readonly fresh: boolean
  readonly checking: boolean
  labelProps(): { for: string }
  helpProps(): { id: string } | undefined
  errorProps(): { id: string; role: 'alert' } | undefined
  setTouched(v?: boolean): void
  onInput(raw: unknown): void
}

/**
 * Связывание описания с Solid: сигналы над `FormStore`, набор пропсов для
 * разметки. Создаётся один раз на жизнь компонента; настройки читаются
 * лениво — объект опций с геттерами, а не снимок.
 * @param cfg Настройка проекта из `createConfig`.
 * @param initial Описание формы.
 * @param o Настройки связки (геттеры читаются в момент события).
 * @returns Связка: состояние, поля, отправка, операции над набором.
 */
export function createForm(cfg: BoundConfig, initial: FormDescription, o: CreateFormOptions = {}) {
  const instance = o.instance ?? `${initial.id}:new`
  const action = o.action ?? '/api/form'

  const render = makeRenderer([initial.messages as never, ru], initial.policy.interpolate)
  const runner = o.checks ? new AsyncRunner(o.checks) : undefined
  const asyncErrorIds = new Map<string, string>()
  const machine = new SubmitMachine(cfg.config.parallel ?? 'block')

  /** Продолжение входит в НАЧАЛЬНОЕ состояние: SSR рисует ошибки на местах. */
  const addressed = (c: Result | null | undefined): c is Result =>
    !!c && c.formId === initial.id && c.instance === instance

  const liftInitial = (c: Result | null | undefined) => {
    if (!addressed(c)) return { state: initialState(initial.revision), lifted: null as Result | null }
    const ctx: ErrorContext = {
      from: c.from, intent: initial.policy.intent.parse('submit').action, outcome: c.outcome,
    }
    const shown = applyHandler(c.errors, ctx, o.onErrors ?? cfg.config.onErrors)
    const base = initialState(initial.revision)
    return {
      lifted: c,
      state: {
        ...base,
        status: c.ok ? 'success' : c.outcome === 'queued' ? 'queued' : 'error',
        result: c, outcome: c.outcome,
        facts: c.errors, shown: shown.errors, removed: shown.removed,
        values: { ...base.values, ...c.values },
        revision: c.revision,
      } as ReturnType<FormStore['getSnapshot']>,
    }
  }

  const started = liftInitial(o.continuation)

  const store = new FormStore(started.state)
  const [state, setState] = createSignal(store.getSnapshot(), { equals: false })
  store.subscribe(() => setState(store.getSnapshot()))

  let submissionId = started.lifted?.submissionId ?? crypto.randomUUID()
  let formEl: HTMLFormElement | null = null

  // описание изменяемо: операции над набором полей строят НОВОЕ описание
  const [description, setDescription] = createSignal(initial)

  const handler = () => o.onErrors ?? cfg.config.onErrors
  const liveMode = (): LiveMode => o.live ?? cfg.config.live ?? 'after-touched'
  const invalidMode = (name: string): InvalidFrom =>
    o.invalidFrom ?? invalidFromFor(name, description(), cfg.config.invalidFrom ?? 'fact')

  /** Факты в показ: один обработчик, оба пути. */
  const display = (facts: readonly FormError[], ctx: ErrorContext) => {
    const shown = applyHandler(facts, ctx, handler())
    if (import.meta.env.DEV && shown.removed > 0)
      console.warn(`[form] обработчик убрал ${shown.removed} из ${facts.length} ошибок`)
    return shown
  }

  const reduceResult = (s: ReturnType<FormStore['getSnapshot']>, result: Result) => {
    const ctx: ErrorContext = {
      from: result.from,
      intent: description().policy.intent.parse(s.pendingIntent ?? 'submit').action,
      outcome: result.outcome,
    }
    const shown = display(result.errors, ctx)
    return {
      ...s,
      status: result.ok ? 'success' : result.outcome === 'queued' ? 'queued' : 'error',
      pending: false, pendingIntent: undefined,
      result, outcome: result.outcome,
      facts: result.errors, shown: shown.errors, removed: shown.removed,
      values: { ...s.values, ...result.values },
      revision: result.revision,
    } as ReturnType<FormStore['getSnapshot']>
  }

  const applyResult = (result: Result) => store.set((s) => reduceResult(s, result))

  /** Продолжение — адресованное сообщение: чужое не применяется. */
  let lifted = started.lifted
  const lift = (result: Result | null | undefined) => {
    if (!result || result === lifted || !addressed(result)) return
    lifted = result
    submissionId = result.submissionId
    applyResult(result)
  }

  const recheck = (name: string) => {
    if (!formEl) return
    const desc = description()
    const ev = evaluate(new FormData(formEl), desc, { render, instance, requireEnvelope: false })
    const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
    const shown = display(ev.errors, ctx)
    store.set((s) => ({
      ...s,
      facts: [...s.facts.filter((e) => e.path !== name), ...ev.errors.filter((e) => e.path === name)],
      shown: [...s.shown.filter((e) => e.path !== name), ...shown.errors.filter((e) => e.path === name)],
    }))
  }

  const scheduleCheck = (name: string) => {
    if (!runner || !formEl) return
    const desc = description()
    if (!asyncRefsOf(desc, name).length) return
    store.set((s) => ({ ...s, checking: { ...s.checking, [name]: true } }))
    runner.schedule(desc, name, Object.fromEntries(new FormData(formEl).entries()), (error) => {
      store.set((s) => {
        const checking = { ...s.checking }
        delete checking[name]
        // Асинхронный ответ заменяет только предыдущую async-ошибку.
        // Синхронные ошибки того же поля (email/minLength/…) сохраняются.
        const previous = asyncErrorIds.get(name)
        const facts = s.facts.filter((e) => e.id !== previous && e.id !== error?.id)
        if (error) { facts.push(error); asyncErrorIds.set(name, error.id) }
        else asyncErrorIds.delete(name)
        const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
        return { ...s, checking, facts, shown: display(facts, ctx).errors }
      })
    })
  }

  /** Операция — данные: тот же SchemaOp применяется и на сервере. */
  const apply = (ops: readonly SchemaOp[]) => {
    const before = description()
    const next = applyOps(before, ops)
    const snap = store.getSnapshot()
    const moved = reconcile(next, before, {
      values: snap.values, facts: snap.facts, dirty: snap.dirty, touched: snap.touched,
    })
    const fresh: Record<string, true> = {}
    for (const f of next.fields) if (f.fresh) fresh[f.name] = true
    const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
    batch(() => {
      store.set((s) => ({
        ...s, revision: next.revision, values: moved.values, facts: moved.facts,
        dirty: moved.dirty, touched: moved.touched, fresh,
        shown: display(moved.facts, ctx).errors,
      }))
      setDescription(next)
    })
    return next
  }

  const viewOf = (f: FieldDescriptor, ui: UiPolicy, snap: ReturnType<FormStore['getSnapshot']>): FieldView => {
    const desc = description()
    const id = ui.fieldId(desc.id, f.name)
    const errors = split(snap.shown).byField[f.name] ?? []
    const value = snap.values[f.name]
    const helpId = `${id}-help`
    const errorId = `${id}-error`
    const has = hasError(f.name, snap.facts, snap.shown, invalidMode(f.name))
    const describedBy = ui.describedBy({
      help: f.help ? helpId : undefined,
      error: errors.length ? errorId : undefined,
    })

    const base = desc.attrsOf(f.name)
    const attrs: HtmlAttrs = { ...base.attrs, name: f.name, id }
    if (has) attrs['aria-invalid'] = true
    if (errors.length) attrs['aria-errormessage'] = errorId
    if (describedBy) attrs['aria-describedby'] = describedBy
    Object.assign(attrs, ui.valueAttrs(f, value))

    return {
      name: f.name, input: f.input, kind: f.kind,
      attrs, skipped: base.skipped,
      label: f.label, help: f.help, placeholder: f.placeholder, options: f.options,
      errors, value, has,
      touched: snap.touched[f.name] === true,
      dirty: snap.dirty[f.name] === true,
      fresh: snap.fresh[f.name] === true,
      checking: snap.checking[f.name] === true,
      labelProps: () => ({ for: id }),
      helpProps: () => (f.help ? { id: helpId } : undefined),
      errorProps: () => (errors.length ? { id: errorId, role: 'alert' as const } : undefined),
      setTouched: (val = true) => {
        store.set((s) => ({ ...s, touched: { ...s.touched, [f.name]: val } }))
        if (ui.shouldValidate({ event: 'blur', name: f.name, live: liveMode(), state: store.getSnapshot() }))
          recheck(f.name)
      },
      onInput: (raw) => {
        store.set((s) => ({
          ...s,
          values: { ...s.values, [f.name]: raw },
          dirty: { ...s.dirty, [f.name]: true },
        }))
        if (ui.shouldValidate({ event: 'input', name: f.name, live: liveMode(), state: store.getSnapshot() }))
          recheck(f.name)
        scheduleCheck(f.name)
      },
    }
  }

  /**
   * Пропсы формы: разворачиваются на `<form {...form().formProps()}>`.
   *
   * `novalidate` ставится ТОЛЬКО в режиме перехвата: нативный путь обязан
   * отдать проверку браузеру — атрибуты ограничений уже на полях. Читается
   * лениво через геттер опций: спред в Solid реактивен, переключатель
   * снимает атрибут без пересоздания связки. Обе стороны (SSR и оживление)
   * вычисляют его из одного состояния — рассинхрона нет.
   */
  const formProps = () => ({
    method: 'post' as const,
    action,
    // Регистрация формы не должна зависеть от отдельного ручного вызова:
    // без неё live- и async-проверки молча не работали.
    ref: (el: HTMLFormElement) => { formEl = el; if (el) assertEnvelope(el) },
    enctype: 'multipart/form-data' as const,
    novalidate: (o.intercept ?? true) || undefined,
    'aria-busy': (state().pending ? true : undefined) as true | undefined,
    onSubmit: (e: SubmitEvent) => {
      if (!(o.intercept ?? true)) return          // отдаём браузеру нативный путь
      e.preventDefault()
      void submit(new FormData(e.currentTarget as HTMLFormElement, e.submitter as HTMLElement | null))
    },
  })

  /** Скрытые поля конверта: обязаны быть в разметке ДО оживления. */
  const hidden = () => {
    const desc = description()
    const env = buildEnvelope({
      formId: desc.id, revision: desc.revision, instance, submissionId,
      specVersion: o.specVersion,
    }, desc.policy)
    return Object.entries(env).map(([name, value]) =>
      ({ type: 'hidden' as const, name, value, readonly: true as const }))
  }

  /** Пропсы кнопки-намерения: `<button {...form.intent('submit')}>`. */
  const intent = (id: string) => {
    const desc = description()
    const descriptor = desc.actions.find((a) => a.id === desc.policy.intent.parse(id).action)
    return {
      name: description().policy.envelopeKeys.intent,
      value: id,
      formnovalidate: descriptor?.validate === 'none' || undefined,
      disabled: state().pending || undefined,
      'aria-busy': (state().pending ? true : undefined) as true | undefined,
    }
  }

  /** Повторяемая группа: ключи стабильны, индекс — производное. */
  const rows = (group: string) => {
    const desc = description()
    const keys = groupRows(desc.fields)[group] ?? []
    const i = (a: string, arg?: string) => intent(desc.policy.intent.format(a, arg))
    return {
      keys,
      row: (key: RowKey) => desc.fields
        .filter((f) => f.name.startsWith(`${group}.${key}.`))
        .map((f) => viewOf(f, cfg.ui, state())),
      add: () => i('add-row', group),
      remove: (key: RowKey) => i('remove-row', `${group}:${key}`),
      move: (key: RowKey, dir: 'up' | 'down') => i('move-row', `${group}:${key}:${dir}`),
      rowProps: (key: RowKey) => ({ 'data-row': key }),
    }
  }

  const submit = async (data: FormData): Promise<Result | undefined> => {
    const desc = description()
    const raw = String(data.get(desc.policy.envelopeKeys.intent) ?? 'submit')
    machine.policy = o.parallel ?? cfg.config.parallel ?? 'block'
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

    const stale = machine.stale(begun.submission, desc.revision)
    machine.finish(begun.submission)
    if (stale) return result

    applyResult(result)
    // Новый пользовательский submit — новая идемпотентная операция.
    if (result.outcome === 'committed' || result.outcome === 'unknown')
      submissionId = crypto.randomUUID()
    return result
  }

  /** `form.f.email` — поля по имени, как в svelte-бинде. */
  const fieldProxy = new Proxy({} as Record<string, FieldView>, {
    get: (_t, name: string) => {
      const f = description().byName[name]
      return f ? viewOf(f, cfg.ui, state()) : undefined
    },
    has: (_t, name: string) => typeof name === 'string' && name in description().byName,
    ownKeys: () => description().fields.map((f) => f.name),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  })

  /** Поля конверта обязаны быть в разметке: предупреждает, а не молчит. */
  const assertEnvelope = (el: HTMLFormElement) => {
    if (!import.meta.env.DEV) return
    const missing = hidden().map((h) => h.name)
      .filter((n) => !el.querySelector(`input[name="${n}"]`))
    if (missing.length)
      console.error(
        `[form] форма '${description().id}': в разметке нет полей конверта: ${missing.join(', ')}. ` +
        'Разверните form.hidden() внутри элемента формы.')
  }

  return {
    get description() { return description() },
    instance,
    get state() { return state() },
    get values() { return state().values },
    get common() { return split(state().shown).common },
    get facts() { return state().facts },
    get shown() { return state().shown },
    setFormEl: (el: HTMLFormElement) => { formEl = el; if (el) assertEnvelope(el) },
    formProps, hidden, intent, submit, lift, apply, rows,
    field: (name: string) => {
      const f = description().byName[name]
      return f ? viewOf(f, cfg.ui, state()) : undefined
    },
    get f() { return fieldProxy },
    select: <T,>(sel: (s: ReturnType<FormStore['getSnapshot']>) => T) => sel(state()),
    /** Поля вне описания: рантайм-дополнения с префиксом `u_`. */
    custom: (prefix = 'u_') => {
      const snap = state()
      return description().fields
        .filter((f) => f.name.startsWith(prefix))
        .map((f) => viewOf(f, cfg.ui, snap))
    },
  }
}

/** Тип связки, возвращаемой `createForm`. */
export type FormBinding = ReturnType<typeof createForm>

const notConfigured: Transport = async () =>
  ({ kind: 'network', code: 'network.failed', detail: 'транспорт не настроен' })
