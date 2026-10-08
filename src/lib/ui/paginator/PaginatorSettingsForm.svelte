<script lang="ts" generics="V extends Record<string, import('$lib/paginate').ExtraValue> = Record<string, import('$lib/paginate').ExtraValue>">
  /**
   * Форма настроек внутри оболочки панели. Отделена от `PaginatorSettings`,
   * потому что смена источника меняет ВЕСЬ компилированный слой (гаты
   * возможностей, а с ними и описание формы): `{#key schema}` пересоздаёт
   * связывание вместе с определением — ровно как `FiltersPanel` с формой
   * фильтров (этап 5).
   *
   * Каждое изменение — `commit: 'live'` в хранилище пагинатора (как жил
   * панельный `setExtra` до переноса); выключения считают: гаты (статика
   * компиляции), гидратация (`jsOnly`) и связки `enabledBy` — через ядро
   * `lib/links`. Причина — в helper (канал `fieldState` → `FieldView`).
   */
  import type { Snippet } from 'svelte'
  import type { ExtraValue } from '$lib/paginate'
  import { bind, createConfig } from '$lib/form/svelte'
  import { computeLinks, linkHelperText } from '$lib/links/links'
  import { buttonVariants } from '$lib/ui/primitives'
  import { JS_ONLY_REASON } from '$lib/ui/js-only.svelte'
  import type { DemoPanelSchema } from './compile'
  import { Field, Select, Toggle } from '$lib/ui/settings'

  interface Props<V extends Record<string, ExtraValue>> {
    schema: DemoPanelSchema
    /** Ключ адреса страницы (`page` | `gallery`) — для hidden до гидратации. */
    pageParam: string
    page: number
    /** Чужие ключи адреса, которые обязан пережить нативный GET. */
    foreign: readonly (readonly [string, string])[]
    action: string
    values: Readonly<Partial<V>>
    pageSize: number
    onExtra(patch: Record<string, ExtraValue>): void
    onSize(n: number): void
    store?: {
      value: string
      options: readonly (readonly [string, string])[]
      onChange(v: string): void
      label?: string
    }
    footer?: Snippet<[{ pageSize: number; page: number }]>
    class?: string
    applyLabel?: string
    noscriptHint?: string
  }

  let {
    schema,
    pageParam,
    page,
    foreign,
    action,
    values,
    pageSize,
    onExtra,
    onSize,
    store: storeProp,
    footer,
    class: className,
    applyLabel = 'Применить',
    noscriptHint,
  }: Props<V> = $props()

  const panelForms = createConfig({
    resolve: () => undefined,
    ui: { fieldId: (_formId, name) => name },
  })

  // Имя = id, как в фильтрах (b1 `bd52745`): адресное имя контрола читается
  // из разметки без второго алфавита.
  // svelte-ignore state_referenced_locally
  const form = bind(panelForms, schema.definition, {
    url: {
      action,
      // Живой режим (live по умолчанию): каждое поле коммитится сразу —
      // панель жила так и до переноса (`setExtra` на изменение).
      // svelte-ignore state_referenced_locally
      seed: () => schema.toSeed(values, pageSize),
      commit: (patch) => {
        const { extra, pageSize: size } = schema.toPatch(patch)
        if (Object.keys(extra).length > 0) onExtra(extra)
        if (size !== undefined) onSize(size)
      },
    },
    fieldState: (name) => {
      const gated = schema.gated.get(name)
      if (gated !== undefined) return { disabled: true, reason: gated }
      if (schema.jsOnly.has(name) && form.submitVisible)
        return { disabled: true, reason: JS_ONLY_REASON }
      const firing = linksOut.fields.get(name)
      if (firing) return { disabled: true, reason: linkHelperText(firing, (id) => schema.label(id)) }
      return undefined
    },
  })

  // Связки панели считаются ПО ЗЕРКАЛУ формы (live-режим: гасить надо сразу
  // на изменении, до похода в хранилище). Boolean-значения чекбоксов — в
  // строковой форме адресных значений ('true'/'false'), пустое — «не выбрано».
  const linksOut = $derived(
    computeLinks(schema.links, (name) => {
      const raw = form.values[name]
      if (raw === undefined || raw === null || raw === '') return []
      return [typeof raw === 'boolean' ? (raw ? 'true' : 'false') : String(raw)]
    }),
  )

  /** До гидратации — нативная GET и hidden-пары; флаг несёт сам механизм (S2). */
  const js = $derived(form.submitVisible)
</script>

<form
  {...form.formProps()}
  data-testid="demo-panel"
  class={className ?? 'rounded-xl border border-border bg-card p-4 text-sm shadow-sm'}
>
  {#if js}
    <input type="hidden" name={pageParam} value={page} />
    {#each foreign as [k, v] (k + '=' + v)}
      <input type="hidden" name={k} value={v} />
    {/each}
  {/if}

  <div class="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 lg:grid-cols-5">
    {#if storeProp}
      <Field label={storeProp.label ?? 'Хранилище настроек и страницы'}>
        <Select
          name="store"
          disabled={js}
          value={storeProp.value}
          onChange={(v) => storeProp.onChange(v)}
          options={storeProp.options}
        />
      </Field>
    {/if}

    {#each schema.groups as group, gi (gi)}
      {#if group.label}
        <div class="col-span-full mt-1 border-t border-border/60 pt-2 text-xs font-medium text-muted-foreground">
          {group.label}
        </div>
      {/if}
      {#each group.items as name (name)}
        {@const v = form.field(name)!}
        {@const kind = schema.kinds.get(name) ?? 'select'}
        {#if kind === 'toggle'}
          <div>
            <Toggle
              name={v.name}
              label={v.label ?? schema.label(name)}
              checked={v.value === true}
              disabled={v.disabled === true}
              hint={v.reason ?? undefined}
              hintId={`${v.attrs.id}-help`}
              hiddenPair={js}
              {...v.attrs}
            />
            {#each v.errors as error (error.id)}
              <p class="mt-0.5 text-xs text-destructive" {...v.errorProps()}>
                {error.message ?? error.code}
              </p>
            {/each}
          </div>
        {:else}
          <Field
            label={v.label ?? schema.label(name)}
            hint={v.reason ?? undefined}
            hintId={`${v.attrs.id}-help`}
          >
            <Select
              name={v.name}
              disabled={v.disabled === true}
              value={v.value === undefined || v.value === null ? '' : String(v.value)}
              options={(v.options ?? []).map((o) => [o.value, o.label] as const)}
              {...v.attrs}
            />
            {#each v.errors as error (error.id)}
              <p class="mt-0.5 text-xs text-destructive" {...v.errorProps()}>
                {error.message ?? error.code}
              </p>
            {/each}
          </Field>
        {/if}
      {/each}
    {/each}
  </div>

  {#if js}
    <div class="mt-3 flex items-center gap-3" data-native-fallback>
      <button type="submit" class={buttonVariants({ size: 'sm' })}>
        {applyLabel}
      </button>
      {#if noscriptHint}
        <span class="text-xs text-muted-foreground">{noscriptHint}</span>
      {/if}
    </div>
  {/if}

  {#if footer}
    <div class="mt-3 text-xs text-muted-foreground" data-testid="restored-from">
      {@render footer({ pageSize, page })}
    </div>
  {/if}
</form>
