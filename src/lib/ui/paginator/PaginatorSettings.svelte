<script lang="ts" generics="V extends Record<string, import('$lib/paginate').ExtraValue> = Record<string, import('$lib/paginate').ExtraValue>">
  import { onMount, type Snippet } from 'svelte'
  import { currentPathname, currentSearch } from '$lib/router/sveltekit'
  import { buttonVariants } from '$lib/ui/primitives'
  import { getPaginator, type Extra, type ExtraValue, type SourceCapability } from '$lib/paginate'
  import { usePaginatorActions, usePaginatorCapabilities, usePaginatorState } from '$lib/paginate/svelte'
  import { Field, Select, Toggle } from './fields'

  /** Патч записи: несколько ключей одним `setExtra` (например, переключение источника + чистка). */
  export type SettingsPatch = Record<string, ExtraValue | undefined>

  export type SettingsField<V extends Record<string, ExtraValue> = Record<string, ExtraValue>> =
    | {
        key: keyof V & string
        label: string
        type: 'select'
        options: readonly (readonly [string, string])[]
        parse?: (raw: string) => ExtraValue
        jsOnly?: boolean
        enabledWhen?: (values: V) => boolean
        /** Возможности источника, без которых параметр недоступен (панель выключит с причиной). */
        requires?: SourceCapability | readonly SourceCapability[]
        /** Что записать в extra: по умолчанию `{ [key]: value }`. */
        patch?: (value: ExtraValue, values: V) => SettingsPatch
      }
    | {
        key: keyof V & string
        label: string
        type: 'toggle'
        jsOnly?: boolean
        enabledWhen?: (values: V) => boolean
        requires?: SourceCapability | readonly SourceCapability[]
        patch?: (value: ExtraValue, values: V) => SettingsPatch
      }
    | {
        type: 'divider'
        label?: string
      }

  /** Подписи возможностей для причины «источник не поддерживает …». */
  const CAPABILITY_LABEL: Record<SourceCapability, string> = {
    search: 'поиск',
    filters: 'фильтры',
    fuzzy: 'lib/search',
    totals: 'число страниц',
  }

  interface Props<V extends Record<string, ExtraValue>> {
    name?: string
    pageSizes?: readonly number[]
    fields?: readonly SettingsField<V>[]
    values?: (extra: Extra) => V
    store?: {
      value: string
      options: readonly (readonly [string, string])[]
      onChange(v: string): void
      label?: string
    }
    renderField?: (
      field: SettingsField<V>,
      ctx: { value: ExtraValue; set(v: ExtraValue): void; disabled: boolean; reason: string | null }
    ) => Snippet | undefined
    footer?: Snippet<[{ pageSize: number; page: number }]>
    class?: string
    applyLabel?: string
    noscriptHint?: string
  }

  let {
    name,
    pageSizes,
    fields = [],
    values: valuesMapper,
    store: storeProp,
    renderField,
    footer,
    class: className,
    applyLabel = 'Применить',
    noscriptHint,
  }: Props<V> = $props()

  const pagState = usePaginatorState(name)
  const capabilities = usePaginatorCapabilities(name)
  const { setExtra, setPageSize } = usePaginatorActions(name)

  const pageParam = $derived(
    getPaginator(pagState().name).adapter.pageParam ?? 'page'
  )

  const currentValues = $derived.by((): V => {
    return valuesMapper ? valuesMapper(pagState().extra) : (pagState().extra as V)
  })

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  const js = $derived(!hydrated)

  // Чужие ключи адреса — через слой фреймворка (канон: панель читает `app.search`),
  // а не `window.location.search`: прямое чтение адреса не даёт `$derived` зависимостей,
  // и копии чужих ключей застывали на моменте создания панели.
  const foreignParams = $derived.by((): [string, string][] => {
    const base = pageParam
    const out: [string, string][] = []
    for (const [k, v] of Object.entries(currentSearch())) {
      if (k === base || k.startsWith(`${base}.`)) continue
      out.push([k, String(v)])
    }
    return out
  })

  /**
   * Доступность поля: JS-требования, возможности ИСТОЧНИКА (панель получает их
   * от пагинатора) и связи между параметрами. Возвращает и причину — её видит
   * пользователь, а не только разработчик в консоли.
   */
  function fieldState(f: SettingsField<V>): { disabled: boolean; reason: string | null } {
    if (!('key' in f)) return { disabled: false, reason: null }
    if ((f.jsOnly ?? false) && js) return { disabled: true, reason: null }
    const caps = capabilities()
    const required = f.requires === undefined ? [] : Array.isArray(f.requires) ? f.requires : [f.requires]
    const missing = (required as readonly SourceCapability[]).filter((capability) => !caps[capability])
    if (missing.length > 0) {
      return {
        disabled: true,
        reason: `источник не поддерживает ${missing.map((capability) => CAPABILITY_LABEL[capability]).join(' и ')}`,
      }
    }
    if (f.enabledWhen && !f.enabledWhen(currentValues)) return { disabled: true, reason: null }
    return { disabled: false, reason: null }
  }

  function setValue(field: { key: string; patch?: (value: ExtraValue, values: V) => SettingsPatch }, v: ExtraValue) {
    setExtra(field.patch ? field.patch(v, currentValues) : { [field.key]: v })
  }
</script>

<form
  method="get"
  action={currentPathname()}
  data-testid="demo-panel"
  class={className ?? 'rounded-xl border border-border bg-card p-4 text-sm shadow-sm'}
  onsubmit={(e) => e.preventDefault()}
>
  {#if !hydrated}
    <input type="hidden" name={pageParam} value={pagState().page} />
    {#each foreignParams as [k, v] (k + '=' + v)}
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

    {#if pageSizes}
      <Field label="Размер страницы">
        <Select
          name={`${pageParam}.size`}
          value={String(pagState().pageSize)}
          onChange={(v) => setPageSize(Number(v))}
          options={pageSizes.map((n) => [String(n), String(n)] as const)}
        />
      </Field>
    {/if}

    {#each fields as f, idx (idx)}
      {#if f.type === 'divider'}
        <div class="col-span-full mt-1 border-t border-border/60 pt-2 text-xs font-medium text-muted-foreground">
          {f.label}
        </div>
      {:else if 'key' in f}
        {@const val = currentValues[f.key]}
        {@const state = fieldState(f)}
        {@const dis = state.disabled}
        {@const custom = renderField?.(f, {
          value: val,
          set: (v) => setValue(f, v),
          disabled: dis,
          reason: state.reason,
        })}
        {#if custom}
          {@render custom()}
        {:else if f.type === 'toggle'}
          <Toggle
            name={`${pageParam}.${f.key}`}
            label={f.label}
            checked={val === true}
            disabled={dis}
            hint={state.reason ?? undefined}
            onChange={(v) => setValue(f, v)}
          />
        {:else if f.type === 'select'}
          <Field label={f.label} hint={state.reason ?? undefined}>
            <Select
              name={`${pageParam}.${f.key}`}
              disabled={dis}
              value={String(val ?? '')}
              onChange={(raw) => setValue(f, f.parse ? f.parse(raw) : raw)}
              options={f.options}
            />
          </Field>
        {/if}
      {/if}
    {/each}
  </div>

  {#if !hydrated}
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
      {@render footer({ pageSize: pagState().pageSize, page: pagState().page })}
    </div>
  {/if}
</form>
