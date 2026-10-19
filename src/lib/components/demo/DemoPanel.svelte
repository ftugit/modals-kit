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

  if (typeof window !== 'undefined') {
    // svelte-ignore state_referenced_locally
    const keys = demoFields(schema)
      .map(demoUrlKey)
      .filter((k): k is string => k !== null)
    // svelte-ignore state_referenced_locally
    if (keys.length > 0) claimQuery(schema.id, ...keys)
  }

  // svelte-ignore state_referenced_locally
  const form = bind(cfg, desc, {
    url: {
      action: schema.action,
      seed: () => valuesNow(),
      commit: untrack(() => (patch: Record<string, unknown>) => {
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

  // Динамический компонент — с большой буквы (правило Svelte).
  const Ui = $derived(ui)

  // Параметры потребителю: один канал и на первый рендер, и на каждое изменение.
  $effect(() => {
    const values = { ...form.values } as DemoValues
    onParams?.(schema.toParams ? schema.toParams(values as V) : values)
  })
</script>

<Form
  {form}
  data-testid={testid}
  class={className ??
    'demo-panel rounded-xl border border-border bg-card p-4 text-sm shadow-sm'}
>

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
