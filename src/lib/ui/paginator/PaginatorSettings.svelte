<script lang="ts" generics="V extends Record<string, import('$lib/paginate').ExtraValue> = Record<string, import('$lib/paginate').ExtraValue>">
  import { onMount, type Snippet } from 'svelte'
  import { currentPathname, currentSearch } from '$lib/router/sveltekit'
  import { buttonVariants } from '$lib/ui/primitives'
  import { getPaginator, type Extra, type ExtraValue } from '$lib/paginate'
  import { usePaginatorActions, usePaginatorState } from '$lib/paginate/svelte'
  import { Field, Select, Toggle } from './fields'

  export type SettingsField<V extends Record<string, ExtraValue> = Record<string, ExtraValue>> =
    | {
        key: keyof V & string
        label: string
        type: 'select'
        options: readonly (readonly [string, string])[]
        parse?: (raw: string) => ExtraValue
        jsOnly?: boolean
        enabledWhen?: (values: V) => boolean
      }
    | {
        key: keyof V & string
        label: string
        type: 'toggle'
        jsOnly?: boolean
        enabledWhen?: (values: V) => boolean
      }
    | {
        type: 'divider'
        label?: string
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
      ctx: { value: ExtraValue; set(v: ExtraValue): void; disabled: boolean }
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

  function fieldDisabled(f: SettingsField<V>): boolean {
    if ('key' in f) {
      if ((f.jsOnly ?? false) && js) return true
      if (f.enabledWhen && !f.enabledWhen(currentValues)) return true
    }
    return false
  }

  function setValue(key: string, v: ExtraValue) {
    setExtra({ [key]: v })
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
        {@const dis = fieldDisabled(f)}
        {@const custom = renderField?.(f, {
          value: val,
          set: (v) => setValue(f.key, v),
          disabled: dis,
        })}
        {#if custom}
          {@render custom()}
        {:else if f.type === 'toggle'}
          <Toggle
            name={`${pageParam}.${f.key}`}
            label={f.label}
            checked={val === true}
            disabled={dis}
            onChange={(v) => setValue(f.key, v)}
          />
        {:else if f.type === 'select'}
          <Field label={f.label}>
            <Select
              name={`${pageParam}.${f.key}`}
              disabled={dis}
              value={String(val ?? '')}
              onChange={(raw) => setValue(f.key, f.parse ? f.parse(raw) : raw)}
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
