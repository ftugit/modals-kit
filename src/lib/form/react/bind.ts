// Слой React: единственное место, где ядро встречается с реактивностью.
//
// Библиотека не создаёт ни одного элемента: всё ниже — наборы пропсов.
// Контракт повторяет svelte-бинд поле в поле: formProps()/hidden() — функции,
// `form.f.email` — прокси полей, rows() — повторяемые группы, FieldView —
// данные поля с attrs/aria-пропсами.
//
//   FormStore + useSyncExternalStore   — состояние (снапшоты стабильны по ссылке)
//   evaluate()                         — та же проверка, что на сервере
//   runSubmit + SubmitMachine          — конвейер и гонки
//   applyHandler/split/hasError        — факт/показ
//   AsyncRunner                        — асинхронные проверки
//   applyOps/reconcile                 — операции над набором полей
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import { AsyncRunner, asyncRefsOf, type CheckRegistry } from '../async'
import type { ConstraintKind } from '../constraints'
import { applyOps, editor, groupRows, reconcile, type SchemaOp } from '../editor'
import { fieldLinkState, type FieldDescriptor, type FieldLink, type FormDescription, type InvalidFrom } from '../describe'
import { applyHandler, hasError, invalidFromFor, notifyResultErrors, split, type ErrorContext, type ErrorSink, type ErrorHandler } from '../errors'
import type { UrlCommitVia, UrlFormOptions } from '../url'
import { buildEnvelope } from '../envelope'
import { makeRenderer, ru } from '../messages'
import type { FormError, Result } from '../result'
import { FormStore, initialState } from '../state'
import { evaluate, runSubmit, SubmitMachine, type ParallelPolicy, type Transport } from '../submit'
import type { HtmlAttrs, RowKey } from '../types'
import type { BoundConfig, LiveMode } from './config'

/** Настройки связки: адрес, режимы и колбэки конкретной формы. */
export interface UseFormOptions {
  /** Адрес нативной отправки. По умолчанию — `/api/form`. */
  action?: string
  instance?: string
  /** Накопленное после нативной отправки: поднимается синхронно при связывании. */
  continuation?: Result | null
  /** Перехватывать отправку. `false` — обычный POST браузером. */
  intercept?: boolean
  live?: LiveMode
  transport?: Transport
  /** Политика параллельных отправок; читается перед каждой отправкой. */
  parallel?: ParallelPolicy
  onErrors?: ErrorHandler
  /** Приёмник системных ошибок (Q1). Перекрывает проектный. */
  onError?: ErrorSink
  /** URL-контур (§6.4): GET до гидратации, живой коммит в sink хоста после. */
  url?: UrlFormOptions
  invalidFrom?: InvalidFrom
  checks?: CheckRegistry
  /** Версия спецификации в конверте: сервер поднимает описание по ней. */
  specVersion?: number
  /**
   * Канал решений связки (lib/links): ответ связки перекрывает статическое
   * объявление поля. Читается лениво на каждом пересчёте представления.
   */
  fieldState?: (name: string) => FieldLink | undefined
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
  /** Поле выключено связкой: видно, но недоступно (disabled ≠ скрыто). */
  readonly disabled?: boolean
  /** Причина выключения — рисуется в helper-слоте; бывает только у выключенного поля. */
  readonly reason?: string
  labelProps(): { htmlFor: string }
  helpProps(): { id: string } | undefined
  errorProps(): { id: string; role: 'alert' } | undefined
  setTouched(v?: boolean): void
  onInput(raw: unknown): void
}

/**
 * Связывание описания с React: состояние через `useSyncExternalStore`,
 * набор пропсов для разметки. Вызывается в компоненте один раз.
 * @param cfg Настройка проекта из `createConfig`.
 * @param initial Описание формы.
 * @param o Настройки связки.
 * @returns Связка: состояние, поля, отправка, операции над набором.
 */
export function useForm(cfg: BoundConfig, initial: FormDescription, o: UseFormOptions = {}) {
  // Настройки читаются ЛЕНИВО, как opts в svelte-бинде: колбэки живут дольше
  // рендера, поэтому замыкание держит не объект опций, а ячейку с ним.
  const oRef = useRef(o)
  oRef.current = o

  const instance = o.instance ?? `${initial.id}:new`
  const action = o.action ?? '/api/form'

  const render = useMemo(
    () => makeRenderer([initial.messages as never, ru], initial.policy.interpolate),
    [initial],
  )
  const store = useMemo(() => {
    const s0 = new FormStore(initialState(initial.revision))
    const c = o.continuation
    // продолжение адресовано этой форме? чужое не применяется
    if (c && c.formId === initial.id && c.instance === (o.instance ?? `${initial.id}:new`)) {
      const ctx: ErrorContext = {
        from: c.from,
        intent: initial.policy.intent.parse('submit').action,
        outcome: c.outcome,
      }
      const shown = applyHandler(c.errors, ctx, o.onErrors ?? cfg.config.onErrors)
      s0.set(() => ({
        ...initialState(initial.revision),
        status: c.ok ? 'success' : c.outcome === 'queued' ? 'queued' : 'error',
        result: c, outcome: c.outcome,
        facts: c.errors, shown: shown.errors, removed: shown.removed,
        values: { ...initialState(initial.revision).values, ...c.values },
        revision: c.revision,
      }))
    }
    return s0
  }, [])
  const machine = useMemo(() => new SubmitMachine(cfg.config.parallel ?? 'block'), [])
  const runner = useMemo(() => (o.checks ? new AsyncRunner(o.checks) : undefined), [])
  const asyncErrorIds = useMemo(() => new Map<string, string>(), [])

  // описание изменяемо: операции над набором полей строят НОВОЕ описание
  const [desc, bump] = useReducer((d: FormDescription, ops: readonly SchemaOp[]) => applyOps(d, ops), initial)

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  const submissionId = useMemo(() => crypto.randomUUID() as string, [])
  // продолжение поднято в начальном состоянии — помечаем поднятым сразу
  const holder = useMemo(() => ({
    sid: o.continuation?.submissionId ?? submissionId,
    formEl: null as HTMLFormElement | null,
    lifted: (o.continuation ?? null) as Result | null | undefined,
    /** Ключ последнего сообщённого результата (Q1, дедуп). */
    notified: undefined as string | undefined,
  }), [])

  // S2: «живой режим после оживления» — флаг переворачивается на mount-эффекте.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!oRef.current.url) return
    setHydrated(true)
    return () => setHydrated(false)
  }, [])
  // URL-режим: зеркало значений от хоста один раз при связке (без валидации).
  useMemo(() => {
    const seed = o.url?.seed
    if (!seed) return
    const seeded = seed(desc)
    if (seeded) store.set((st) => ({ ...st, values: { ...st.values, ...seeded } }))
  }, [])

  const handler = () => oRef.current.onErrors ?? cfg.config.onErrors
  const liveMode = () => oRef.current.live ?? cfg.config.live ?? 'after-touched'
  const invalidMode = (name: string): InvalidFrom =>
    oRef.current.invalidFrom ?? invalidFromFor(name, desc, cfg.config.invalidFrom ?? 'fact')

  /** Факты в показ: один обработчик, оба пути. */
  const display = useCallback((facts: readonly FormError[], ctx: ErrorContext) => {
    const shown = applyHandler(facts, ctx, handler())
    if (import.meta.env.DEV && shown.removed > 0)
      console.warn(`[form] обработчик убрал ${shown.removed} из ${facts.length} ошибок`)
    return shown
  }, [])

  /** Чистая редукция: результат → состояние. Нужна и при инициализации. */
  const reduceResult = useCallback((s: ReturnType<FormStore['getSnapshot']>, result: Result) => {
    const ctx: ErrorContext = {
      from: result.from,
      intent: desc.policy.intent.parse(s.pendingIntent ?? 'submit').action,
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
  }, [desc, display])

  const applyResult = useCallback((result: Result) => {
    store.set((s) => reduceResult(s, result))
    // Q1: наблюдатель после применения; holder — переживает рендеры (дедуп).
    holder.notified = notifyResultErrors(oRef.current.onError ?? cfg.config.onError, result, holder.notified)
  }, [cfg, holder, oRef, reduceResult, store])

  /** Продолжение — адресованное сообщение: чужое не применяется. */
  const lift = useCallback((result: Result | null | undefined) => {
    if (!result || result === holder.lifted) return
    if (result.formId !== desc.id || result.instance !== instance) return
    holder.lifted = result
    holder.sid = result.submissionId
    applyResult(result)
  }, [applyResult, desc, holder, instance])

  const recheck = useCallback((name: string) => {
    if (!holder.formEl) return
    const ev = evaluate(new FormData(holder.formEl), desc, { render, instance, requireEnvelope: false })
    const ctx: ErrorContext = { from: 'fetch', intent: 'submit', outcome: 'not-applied' }
    const shown = display(ev.errors, ctx)
    store.set((s) => ({
      ...s,
      facts: [...s.facts.filter((e) => e.path !== name), ...ev.errors.filter((e) => e.path === name)],
      shown: [...s.shown.filter((e) => e.path !== name), ...shown.errors.filter((e) => e.path === name)],
    }))
  }, [desc, display, holder, instance, render, store])

  const scheduleCheck = useCallback((name: string) => {
    if (!runner || !holder.formEl) return
    if (!asyncRefsOf(desc, name).length) return
    store.set((s) => ({ ...s, checking: { ...s.checking, [name]: true } }))
    runner.schedule(desc, name, Object.fromEntries(new FormData(holder.formEl).entries()), (error) => {
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
  }, [desc, display, holder, runner, store])

  /** Операция — данные: тот же SchemaOp применяется и на сервере. */
  const apply = useCallback((ops: readonly SchemaOp[]) => {
    const before = desc
    const next = applyOps(before, ops)
    const moved = reconcile(next, before, {
      values: store.getSnapshot().values,
      facts: store.getSnapshot().facts,
      dirty: store.getSnapshot().dirty,
      touched: store.getSnapshot().touched,
    })
    const fresh: Record<string, true> = {}
    for (const fd of next.fields) if (fd.fresh) fresh[fd.name] = true
    store.set((s) => ({
      ...s, revision: next.revision, values: moved.values, facts: moved.facts,
      dirty: moved.dirty, touched: moved.touched, fresh,
      shown: display(moved.facts, { from: 'fetch', intent: 'submit', outcome: 'not-applied' }).errors,
    }))
    bump(ops)
    return next
  }, [desc, display, store])

  const viewOf = useCallback((f: FieldDescriptor): FieldView => {
    const id = cfg.ui.fieldId(desc.id, f.name)
    const byField = split(state.shown).byField
    const errors = byField[f.name] ?? []
    const value = state.values[f.name]
    const helpId = `${id}-help`
    const errorId = `${id}-error`
    const has = hasError(f.name, state.facts, state.shown, invalidMode(f.name))
    // Решение связки поверх объявления поля; инвариант reason⊂disabled — в fieldLinkState.
    const ls = fieldLinkState(f, oRef.current.fieldState?.(f.name))
    const describedBy = cfg.ui.describedBy({
      help: f.help || ls.reason ? helpId : undefined,
      error: errors.length ? errorId : undefined,
    })

    const base = desc.attrsOf(f.name)
    const attrs: HtmlAttrs = toReactProps({ ...base.attrs, name: f.name, id })
    if (ls.disabled) attrs.disabled = true
    if (has) attrs['aria-invalid'] = true
    if (errors.length) attrs['aria-errormessage'] = errorId
    if (describedBy) attrs['aria-describedby'] = describedBy
    Object.assign(attrs, cfg.ui.valueAttrs(f, value))

    return {
      name: f.name, input: f.input, kind: f.kind,
      attrs, skipped: base.skipped,
      label: f.label, help: f.help, placeholder: f.placeholder, options: f.options,
      errors, value, has,
      disabled: ls.disabled, reason: ls.reason,
      touched: state.touched[f.name] === true,
      dirty: state.dirty[f.name] === true,
      fresh: state.fresh[f.name] === true,
      checking: state.checking[f.name] === true,
      labelProps: () => ({ htmlFor: id }),
      helpProps: () => (f.help || ls.reason ? { id: helpId } : undefined),
      errorProps: () => (errors.length ? { id: errorId, role: 'alert' as const } : undefined),
      setTouched: (val = true) => {
        store.set((s) => ({ ...s, touched: { ...s.touched, [f.name]: val } }))
        if (cfg.ui.shouldValidate({ event: 'blur', name: f.name, live: liveMode(), state: store.getSnapshot() }))
          recheck(f.name)
      },
      onInput: (raw) => {
        store.set((s) => ({
          ...s,
          values: { ...s.values, [f.name]: raw },
          dirty: { ...s.dirty, [f.name]: true },
        }))
        if (cfg.ui.shouldValidate({ event: 'input', name: f.name, live: liveMode(), state: store.getSnapshot() }))
          recheck(f.name)
        scheduleCheck(f.name)
      },
    }
  }, [cfg, desc, recheck, scheduleCheck, state, store])

  /** Поля конверта обязаны быть в разметке: предупреждает, а не молчит. */
  // S3: неразмещённое поле (url-режим: поле обязано быть в разметке, конверта нет).
  const assertPlacement = (el: HTMLFormElement) => {
    if (!import.meta.env.DEV) return
    const missing = desc.fields
      .filter((f) => !f.name.startsWith('u_'))       // runtime-семья custom() живёт не в объявлении
      .filter((f) => !el.querySelector(`[name="${f.name}"]`))
      .map((f) => f.name)
    if (missing.length)
      console.error(
        `[form] форма '${desc.id}': в разметке нет полей: ${missing.join(', ')}. ` +
        'Разместите каждое поле field(name) или уберите его из описания.')
  }

  const assertEnvelope = (el: HTMLFormElement) => {
    if (!import.meta.env.DEV) return
    const missing = hidden().map((h) => h.name)
      .filter((n) => !el.querySelector(`input[name="${n}"]`))
    if (missing.length)
      console.error(
        `[form] форма '${desc.id}': в разметке нет полей конверта: ${missing.join(', ')}. ` +
        'Разверните form.hidden() внутри элемента формы.')
  }

  /** Реагирует на появление/снятие формы: ядро читает DOM только здесь. */
  const attachRef = useCallback((el: HTMLFormElement | null) => {
    holder.formEl = el
    if (el) {
      assertEnvelope(el)
      if (oRef.current.url) assertPlacement(el)
    }
  }, [desc, holder])

  /**
   * Пропсы формы: разворачиваются на `<form {...form.formProps()}>`.
   *
   * ФУНКЦИЯ, как в svelte-бинде: значения читаются в момент отрисовки, а не
   * запоминаются мемо. `novalidate` ставится ТОЛЬКО в режиме перехвата:
   * нативный путь обязан отдать проверку браузеру — атрибуты ограничений уже
   * на полях. В React это проп, а не эффект после отрисовки: обе стороны
   * (SSR и оживление) вычисляют его из одного состояния — рассинхрона нет.
   */
  const commitUrl = (via: UrlCommitVia, name?: string) => {
    const url = oRef.current.url
    const el = holder.formEl
    if (!url || !el) return
    const ev = evaluate(new FormData(el), desc, { render, instance, requireEnvelope: false })
    const patch: Record<string, unknown> = {}
    for (const f of desc.fields) patch[f.name] = ev.values[f.name]
    url.commit(patch, via)
    store.set((st) => ({ ...st, values: { ...st.values, ...patch } }))
    if (name) recheck(name)
  }

  // S2: живой режим — `change` на форме (делегирование: любой контрол, любой тип).
  useEffect(() => {
    if (!oRef.current.url) return
    const live = (ev: Event) => {
      const t = ev.target as HTMLInputElement | null
      if (t?.name) commitUrl('field', t.name)
    }
    const el = holder.formEl
    el?.addEventListener('change', live)
    return () => el?.removeEventListener('change', live)
  }, [])

  const formProps = () => {
    if (oRef.current.url) {
      return {
        method: 'get' as const,
        action: oRef.current.url.action ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
        noValidate: hydrated as boolean,
        'aria-busy': (state.pending ? true : undefined) as true | undefined,
        onSubmit: (e: FormEvent<HTMLFormElement>) => {
          if (!hydrated) return                    // нативный GET до оживления (и без JS)
          e.preventDefault()
          commitUrl('submit')
        },
        ref: attachRef,
      }
    }
    return {
    method: 'post' as const,
    action,
    encType: 'multipart/form-data',
    noValidate: (oRef.current.intercept ?? true) as boolean,
    'aria-busy': (state.pending ? true : undefined) as true | undefined,
    onSubmit: (e: FormEvent<HTMLFormElement>) => {
      if (!(oRef.current.intercept ?? true)) return     // отдаём браузеру нативный путь
      e.preventDefault()
      const el = e.currentTarget
      const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
      void submit(new FormData(el, submitter))
    },
    ref: attachRef,
  }
  }

  /**
   * Скрытые поля конверта: обязаны быть в разметке ДО оживления.
   *
   * Номер отправки (`__form_submission`) рождается crypto.randomUUID() на
   * КАЖДОЙ стороне, и React сверяет value контролируемых инпутов при
   * гидратации — поэтому для него defaultValue: неконтролируемое поле не
   * сверяется, в DOM остаётся номер сервера. Остальные ключи детерминированы:
   * им нужен value, чтобы смена ревизии после apply() доехала до DOM.
   */
  const hidden = () => {
    // URL-режим: конверт не участвует — ни в DOM, ни в адрес.
    if (oRef.current.url) return []
    const env = buildEnvelope({
      formId: desc.id, revision: desc.revision, instance, submissionId: holder.sid,
      specVersion: o.specVersion,
    }, desc.policy)
    const sub = desc.policy.envelopeKeys.submission
    return Object.entries(env).map(([name, value]) =>
      name === sub
        ? { type: 'hidden' as const, name, defaultValue: value, readOnly: true as const }
        : { type: 'hidden' as const, name, value, readOnly: true as const })
  }

  /** Пропсы кнопки-намерения: `<button {...form.intent('submit')}>`. */
  const intent = useCallback((id: string) => {
    const descriptor = desc.actions.find((a) => a.id === desc.policy.intent.parse(id).action)
    return {
      name: desc.policy.envelopeKeys.intent,
      value: id,
      formNoValidate: descriptor?.validate === 'none' || undefined,
      disabled: state.pending || undefined,
      'aria-busy': (state.pending ? true : undefined) as true | undefined,
    }
  }, [desc, state.pending])

  /** Повторяемая группа: ключи стабильны, индекс — производное. */
  const rows = useCallback((group: string) => {
    const keys = groupRows(desc.fields)[group] ?? []
    const i = (a: string, arg?: string) => intent(desc.policy.intent.format(a, arg))
    return {
      keys,
      row: (key: RowKey) => desc.fields
        .filter((f) => f.name.startsWith(`${group}.${key}.`))
        .map((f) => viewOf(f)),
      add: () => i('add-row', group),
      remove: (key: RowKey) => i('remove-row', `${group}:${key}`),
      move: (key: RowKey, dir: 'up' | 'down') => i('move-row', `${group}:${key}:${dir}`),
      rowProps: (key: RowKey) => ({ 'data-row': key }),
    }
  }, [desc, intent, viewOf])

  /**
   * Отправка через перехват: конверт → локальная проверка тем же `evaluate`
   * → транспорт → применение результата. Устаревшая отправка отбрасывается.
   * @param data Данные формы с намерением.
   */
  const submit = useCallback(async (data: FormData): Promise<Result | undefined> => {
    const raw = String(data.get(desc.policy.envelopeKeys.intent) ?? 'submit')
    machine.policy = oRef.current.parallel ?? cfg.config.parallel ?? 'block'
    const begun = await machine.acquire(desc.revision, raw, holder.sid)
    if (!begun.go) return undefined

    store.set((s) => ({
      ...s, status: 'submitting', pending: true, pendingIntent: raw,
      submitCount: s.submitCount + 1,
    }))

    const result = await runSubmit({
      description: desc, data, instance, intent: raw,
      submission: begun.submission,
      transport: oRef.current.transport ?? cfg.config.transport ?? notConfigured,
      render,
    })

    const stale = machine.stale(begun.submission, desc.revision)
    machine.finish(begun.submission)
    if (stale) return result

    applyResult(result)
    // Идемпотентность относится к одной логической отправке, а не ко всей
    // жизни формы. Иначе повторная осмысленная отправка получит старый кэш.
    if (result.outcome === 'committed' || result.outcome === 'unknown')
      holder.sid = crypto.randomUUID()
    return result
  }, [applyResult, cfg, desc, holder, instance, machine, render, store])

  // продолжение уже в начальном состоянии (см. store): подъём в рендере
  // опоздал бы для SSR — useSyncExternalStore читает снимок до store.set

  const field = useCallback((name: string) =>
    desc.byName[name] ? viewOf(desc.byName[name]!) : undefined, [desc, viewOf])

  /** `form.f.email` — поля по имени, как в svelte-бинде. */
  const f = useMemo(() => new Proxy({} as Record<string, FieldView>, {
    get: (_t, name: string) => {
      const fd = desc.byName[name]
      return fd ? viewOf(fd) : undefined
    },
    has: (_t, name: string) => typeof name === 'string' && name in desc.byName,
    ownKeys: () => desc.fields.map((fd) => fd.name),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  }), [desc, viewOf])

  return {
    description: desc, instance,
    state, values: state.values,
    /** Общие ошибки: у них нет пути. */
    common: useMemo(() => split(state.shown).common, [state.shown]),
    facts: state.facts, shown: state.shown,
    get submitVisible() { return !hydrated },
    formProps, hidden, intent, submit, lift, apply, rows, field, f,
    select: <T,>(sel: (s: typeof state) => T) => sel(state),
    /** Поля, созданные в рантайме: отличаются только префиксом имени. */
    custom: (prefix = 'u_') => desc.fields.filter((fd) => fd.name.startsWith(prefix)).map(viewOf),
  }
}

/** Тип связки, возвращаемой `useForm`. */
export type BoundForm = ReturnType<typeof useForm>

const notConfigured: Transport = async () =>
  ({ kind: 'network', code: 'network.failed', detail: 'транспорт не настроен' })

/**
 * Имена атрибутов ядра — HTML-ные (`maxlength`, `inputmode`). React ждёт
 * camelCase-пропсы, иначе — предупреждение и риск рассинхрона при оживлении.
 * Перевод живёт в адаптере: ядро говорит на языке разметки.
 */
const REACT_PROPS: Record<string, string> = {
  maxlength: 'maxLength', minlength: 'minLength', inputmode: 'inputMode',
  autocomplete: 'autoComplete', novalidate: 'noValidate', enctype: 'encType',
  spellcheck: 'spellCheck', tabindex: 'tabIndex', readonly: 'readOnly',
}
function toReactProps<T extends Record<string, unknown>>(attrs: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) out[REACT_PROPS[k] ?? k] = v
  return out as T
}
