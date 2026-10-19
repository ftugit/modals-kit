<script lang="ts" generics="V extends DemoValues = DemoValues">
  /**
   * Универсальная демо-панель: схема (данные) на входе — параметры и адрес на
   * выходе. Всё, что раньше каждая страница писала руками (seed из `?ключей`,
   * сборка ссылки, «Применить» до оживления, hidden-пары тумблеров), делает
   * компонент через `#lib/address`; страница получает параметры и больше ничего
   * про адрес не знает.
   *
   * Канон панелей сохранён: это ФОРМА (нативный GET без JS, кнопка «Применить»
   * только до оживления), jsOnly-варианты до оживления выключены, живое
   * применение — мелкой записью адреса (не полной навигацией: та гибнет под
   * модальным слоем списка).
   */
  import type { Component, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { Form, bind, createConfig, type BoundForm } from '#lib/form/svelte/index.js'
  import { Field, Select, Toggle } from '#lib/components/settings/index.js'
  import { Input, buttonVariants } from '#lib/components/ui/index.js'
  import { claimQuery } from '#lib/address/keys.js'
  import { visibleAddress, writeAddress } from '#lib/address/sveltekit.js'
  import type { DemoPanelSchema, DemoValues } from './types.js'
  import type { DemoUiProps } from './ui.js'
  import { demoFieldUi } from './ui.js'
  import {
    demoFields,
    demoForm,
    demoHref,
    demoParams,
    demoScenarioChange,
    demoUrlKey,
  } from './schema.js'

  interface Props<V extends DemoValues> {
    schema: DemoPanelSchema<V>
    /** Значения не-адресных полей (`url: false`): их приёмник — библиотека. */
    values?: Readonly<Partial<V>>
    /** Параметры для потребителя: панель уже применила адрес. */
    onParams?: (params: Record<string, unknown>) => void
    /** Подвал панели (пояснения страницы). */
    footer?: Snippet
    /**
     * Скрытые поля нативной GET: ключи, которые панель обязана сохранить,
     * хотя схеме они не принадлежат (указатель страницы, чужие фильтры).
     * Имена полей самой панели сюда не попадают: скрытое поле с тем же именем
     * декодер прочтёт раньше контрола и подменит живое значение адресом.
     */
    hidden?: readonly { name: string; value: unknown }[]
    /**
     * Ведущий контрол ВНЕ схемы — слот приёмника (хранилище настроек
     * пагинатора). Получает связывание панели: до оживления он выключен,
     * как и «Применить».
     */
    leading?: Snippet<[BoundForm]>
    /**
     * Своя разметка полей — компонент приложения (как `form` у фильтров):
     * панель отдаёт ему `field(name)` с готовыми вьюхами и придерживается
     * собственной оболочки (форма, «Применить», подвал). Пример —
     * `routes/(site)/(app)/steps/StepsDemoFields.svelte`.
     */
    ui?: Component<DemoUiProps>
    class?: string
    testid?: string
    applyLabel?: string
    /** Подсказка рядом с «Применить»: видна, пока страница не ожила (и без JS). */
    fallbackHint?: string
  }

  let {
    schema,
    values: external,
    onParams,
    footer,
    hidden,
    leading,
    ui,
    class: className,
    testid = 'demo-panel',
    applyLabel = 'Применить',
    fallbackHint,
  }: Props<V> = $props()

  // Схема — данные страницы: на монтировании одна, пересоздание — {#key} у потребителя.
  // svelte-ignore state_referenced_locally
  const desc = demoForm(schema)
  const cfg = createConfig({
    resolve: () => undefined,
    ui: { fieldId: (_formId, name) => name },
  })

  /** Внешние значения не-адресных полей (панель их только проводит). */
  function externalValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const src = external as Record<string, unknown> | undefined
    if (!src) return out
    for (const f of demoFields(schema)) if (demoUrlKey(f) === null && src[f.key] !== undefined) out[f.key] = src[f.key]
    return out
  }

  /** Значения, которые панель видит прямо сейчас: адрес + внешние. */
  function valuesNow(): Record<string, unknown> {
    return { ...demoParams(schema, visibleAddress().url), ...externalValues() }
  }

  // svelte-ignore state_referenced_locally
  const urlKeys = demoFields(schema)
    .map(demoUrlKey)
    .filter((k): k is string => k !== null)
  /** Панель владеет адресом, только если у неё есть адресные поля. */
  const ownsAddress = urlKeys.length > 0

  // svelte-ignore state_referenced_locally
  if (typeof window !== 'undefined' && ownsAddress) claimQuery(schema.id, ...urlKeys)

  /**
   * Чужие ключи адреса — в нативную GET-форму скрытыми полями: без JavaScript
   * отправка панели не имеет права терять шаг страницы, страницу пагинатора
   * или фильтры. Ключи панели сюда не попадают (их пишет сама форма), имя
   * экшена (`/save`) — тоже.
   */
  // svelte-ignore state_referenced_locally
  const carried = untrack(() => {
    // Имена полей панели скрытыми не дублируются: пара «скрытое + контрол» с
    // одним именем отдавала бы форме ЧУЖОЕ значение (страница пагинатора
    // передавала так свои ключи, и коммит читал адрес вместо контролов).
    const own = new Set([...urlKeys, ...demoFields(schema).map((f) => f.key)])
    const out = new Map<string, { name: string; value: unknown }>()
    for (const [name, value] of visibleAddress().url.searchParams)
      if (!own.has(name) && !name.startsWith('/')) out.set(name, { name, value })
    for (const h of hidden ?? []) if (!own.has(h.name)) out.set(h.name, h)
    return [...out.values()]
  })

  // svelte-ignore state_referenced_locally
  const form = bind(cfg, desc, {
    // `url` подключается ВСЕГДА: он же ведёт зеркало формы (форма слушает
    // `change` и читает DOM). Панель без адресных полей ничего не пишет —
    // коммит ей нечего делать в адресе.
    url: {
      action: schema.action,
      seed: () => valuesNow(),
      commit: untrack(() => (patch: Record<string, unknown>) => {
        // Параметры — СРАЗУ, в том же событии, что и правка поля. Потребитель
        // пишет приёмник синхронно (пагинатор — в адрес через свой адаптер);
        // отложенный эффект опаздывал к закрытию списка-слоя и правка
        // откатывалась шагом истории (`page.src` на узком экране).
        const next = { ...(form.values as DemoValues), ...patch } as DemoValues
        onParams?.(schema.toParams ? schema.toParams(next as V) : next)
        if (!ownsAddress) return
        const current = visibleAddress().url
        const before = valuesNow()
        const values = { ...before, ...patch }
        // Смена сценарного поля пересобирает адрес (чужие ключи сценария
        // снимаются). Остальные правки трогают только свои ключи.
        const scenario = demoScenarioChange(schema, before, values) !== null
        const href = demoHref(schema, values, current, { resetScenario: scenario })
        void writeAddress(() => ({ url: href }), {
          replace: false,
          load: schema.load ?? false,
          ...(scenario ? {} : { owner: schema.id }),
        })
      }),
    },
  })

  /**
   * Не-адресные поля (`url: false`) — зеркало чужого источника истины:
   * хранилища пагинатора, конфига хоста модалок. Догоняем форму ТОЛЬКО когда
   * изменился сам источник: иначе эхо собственной правки (пока приёмник не
   * применил значение) откатывало бы ввод — на `/modals` это гасило выбор
   * `default_mobile`. Внутренние чтения — `untrack`: зависимость у эффекта
   * одна, внешнее значение.
   */
  // svelte-ignore state_referenced_locally
  let seenExternal = untrack(() => JSON.stringify(external ?? null))
  $effect(() => {
    const src = external as Record<string, unknown> | undefined
    if (!src) return
    // Смотрим на СОДЕРЖАНИЕ, а не на объект: потребитель пересобирает `values`
    // на каждое изменение своего состояния, а запись в приёмник бывает
    // асинхронной — пока она в полёте, источник ещё стар, и зеркало по
    // идентичности откатывало бы только что выбранное значение (`page.src`).
    const key = JSON.stringify(src)
    if (key === seenExternal) return
    seenExternal = key
    untrack(() => {
      for (const f of demoFields(schema)) {
        if (demoUrlKey(f) !== null) continue
        const want = src[f.key]
        if (want === undefined) continue
        const v = form.field(f.key)
        if (!v) continue
        const current = v.value
        const differs =
          typeof want === 'boolean' ? current !== want : String(current ?? '') !== String(want)
        if (differs) v.onInput(want)
      }
    })
  })

  // Динамический компонент — с большой буквы (правило Svelte).
  const Ui = $derived(ui)

  // Параметры потребителю: один канал и на первый рендер, и на каждое изменение.
  $effect(() => {
    const values = { ...form.values } as DemoValues
    onParams?.(schema.toParams ? schema.toParams(values as V) : values)
  })
</script>

<!-- Карточка панели: `leading` живёт В ней, но ВНЕ формы — это не поле панели, и
     его `change` не должен отправлять набор полей (иначе смена хранилища
     коммитила бы прежние значения формы в новое хранилище). -->
<div
  class={className ??
    'demo-panel rounded-xl border border-border bg-card p-4 text-sm shadow-sm'}
  data-testid={testid}
>
{#if leading}
  <div class="mb-3" data-demo-leading>
    {@render leading(form)}
  </div>
{/if}

<!-- Скрытые поля — только для НАТИВНОЙ отправки: после оживления адрес несёт
     сама форма (поля + коммит), и вторая пара с тем же именем читалась бы
     декодером раньше контрола. -->
<Form {form} hiddenFields={form.submitVisible ? carried : []} data-demo-form>

  {#if ui}
    <Ui
      {form}
      schema={schema as DemoPanelSchema}
      values={form.values as DemoValues}
      field={(name) => demoFieldUi(schema as DemoPanelSchema, form, name)}
    />
  {:else}
    <!-- Столбцы считаются от ширины ПАНЕЛИ (container query), а не окна: панель
         живёт и в колонке страницы, и в боковой колонке галереи. -->
    <div class="@container">
      <div class="grid grid-cols-2 gap-x-4 gap-y-3 @lg:grid-cols-3 @5xl:grid-cols-5">
        {#each schema.fields as spec, i (i)}
          {#if spec.type === 'divider'}
            <div class="col-span-full mt-1 border-t border-border/60 pt-2 text-xs font-medium text-muted-foreground">
              {spec.label}
            </div>
          {:else}
            {@const f = demoFieldUi(schema as DemoPanelSchema, form, spec.key)}
            {@const v = f.v}
            {#if spec.type === 'toggle'}
              <div>
                <Toggle
                  {...v.attrs}
                  name={v.name}
                  label={v.label ?? spec.label}
                  checked={v.value === true}
                  disabled={f.disabled}
                  hint={f.hint}
                  hintId={`${v.attrs.id}-help`}
                  hiddenPair={form.submitVisible}
                />
                {#each v.errors as error (error.id)}
                  <p class="mt-0.5 text-xs text-destructive" {...v.errorProps()}>
                    {error.message ?? error.code}
                  </p>
                {/each}
              </div>
            {:else}
              <Field
                label={v.label ?? spec.label}
                hint={f.hint}
                hintId={`${v.attrs.id}-help`}
              >
                {#if spec.type === 'select'}
                  <Select
                    {...v.attrs}
                    name={v.name}
                    value={v.value === undefined || v.value === null ? '' : String(v.value)}
                    disabled={f.disabled}
                    options={f.options}
                  />
                {:else}
                  <Input
                    {...v.attrs}
                    name={v.name}
                    value={v.value === undefined || v.value === null ? '' : String(v.value)}
                    disabled={f.disabled}
                    oninput={(e) => v.onInput?.(e.currentTarget.value)}
                  />
                {/if}
                {#each v.errors as error (error.id)}
                  <p class="mt-0.5 text-xs text-destructive" {...v.errorProps()}>
                    {error.message ?? error.code}
                  </p>
                {/each}
              </Field>
            {/if}
          {/if}
        {/each}
      </div>
    </div>
  {/if}

  {#if form.submitVisible}
    <div class="mt-3 flex items-center gap-3" data-native-fallback>
      <button type="submit" class={buttonVariants({ size: 'sm' })}>{applyLabel}</button>
      {#if fallbackHint}
        <span class="text-xs text-muted-foreground">{fallbackHint}</span>
      {/if}
    </div>
  {/if}

  {#if footer}
    <div class="mt-3 text-xs text-muted-foreground">
      {@render footer()}
    </div>
  {/if}
</Form>
</div>
