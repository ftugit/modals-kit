<script lang="ts" generics="V extends Record<string, import('#lib/paginate/index.js').ExtraValue> = Record<string, import('#lib/paginate/index.js').ExtraValue>">
  /**
   * Панель настроек пагинатора — на универсальном `DemoPanel` (этап 2).
   *
   * Здесь осталось ровно то, что знает домен пагинатора: имя экземпляра,
   * его хранилище (`setExtra`/`setPageSize`), слот выбора хранилища, подвал
   * и слот нативной GET (указатель страницы + чужие ключи). Схема полей,
   * форма, «Применить» до оживления, hidden-пары тумблеров — панели.
   *
   * Адрес панель не пишет: все поля `url: false`, ключами `page`/`page.*`
   * владеет адаптер источника. Он же читает их из адреса при загрузке —
   * поэтому панель отдаёт значения параметрами, а не строит ссылку.
   */
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import type { BoundForm } from '#lib/form/svelte/index.js'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import { featureGates, getPaginator, type Extra, type ExtraValue } from '#lib/paginate/index.js'
  import { usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { DemoPanel } from '#lib/components/demo/index.js'
  import { Field, Select } from '#lib/components/settings/index.js'
  import { paginatorPanel } from './compile'
  import type { SettingsField } from './types'

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
    footer?: Snippet<[{ pageSize: number; page: number }]>
    class?: string
    applyLabel?: string
    fallbackHint?: string
  }

  let {
    name: nameProp,
    pageSizes,
    fields = [],
    values: valuesMapper,
    store: storeProp,
    footer,
    class: className,
    applyLabel,
    fallbackHint,
  }: Props<V> = $props()

  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)

  const pagState = usePaginatorState(name)
  const { setExtra, setPageSize } = usePaginatorActions(name)

  const pageParam = $derived(getPaginator(pagState().name).adapter.pageParam ?? 'page')
  /**
   * Возможности текущего источника — серверные данные: чем источник не
   * умеет — тем панель не управляет (поле гасится статически, с причиной).
   */
  const gates = $derived(featureGates(pagState().capabilities))

  const currentValues = $derived(
    valuesMapper ? valuesMapper(pagState().extra) : (pagState().extra as V),
  )

  // Чужие ключи адреса — через слой фреймворка (канон: панель читает
  // `app.search`): они обязаны пережить нативный GET. Что чужое, решает
  // адаптер (`carryFields`, `'*'` — все свои ключи несёт сама форма).
  const foreignParams = $derived.by((): [string, string][] =>
    (getPaginator(pagState().name).adapter.carryFields?.(currentSearch(), ['*']) ?? []).map((f) => [f.name, f.value]),
  )

  const action = $derived(currentPathname())

  const panel = $derived(
    paginatorPanel<V>({ pageParam, action, pageSizes, fields, gates }),
  )

  /** Значения панели — зеркало хранилища: панель догоняет его сама (`values`). */
  const panelValues = $derived(panel.toPanel(currentValues, pagState().pageSize))

  /**
   * Пересоздание формы — только когда меняется ЕЁ состав: источник (гаты),
   * префикс адреса, адрес действия. Смена страницы/значений — не повод
   * терять фокус.
   */
  const panelKey = $derived(
    `${action}|${pageParam}|${Object.entries(gates)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([gate, open]) => `${gate}${open ? '+' : '-'}`)
      .join(',')}`,
  )

  /**
   * Патч — только по РАЗЛИЧИЮ с ПОСЛЕДНИМ ОТПРАВЛЕННЫМ, а не с хранилищем:
   * запись в него асинхронна, и пока она в полёте, зеркало ещё держит прежнее
   * значение. Сравнение с хранилищем отправляло бы его назад и гасило только что
   * сделанный выбор (две быстрые правки подряд: `page.size`, затем раскладка).
   */
  // svelte-ignore state_referenced_locally
  let lastSent = untrack(() => ({ ...(panelValues as Record<string, unknown>) }))

  function apply(params: Record<string, unknown>): void {
    const changed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params))
      if (!Object.is(value, lastSent[key])) changed[key] = value
    if (Object.keys(changed).length === 0) return
    lastSent = { ...lastSent, ...changed }
    const { extra, size } = panel.toPatch(changed)
    if (Object.keys(extra).length > 0) void setExtra(extra)
    if (size !== undefined && size !== pagState().pageSize) void setPageSize(size)
  }
</script>

{#snippet storeField(form: BoundForm)}
  {#if storeProp}
    <Field label={storeProp.label ?? 'Хранилище настроек и страницы'}>
      <Select
        name="store"
        disabled={form.submitVisible}
        value={storeProp.value}
        onChange={(v) => storeProp.onChange(v)}
        options={storeProp.options}
      />
    </Field>
  {/if}
{/snippet}

{#snippet footerLine()}
  {@render footer?.({ pageSize: pagState().pageSize, page: pagState().page })}
{/snippet}

{#key panelKey}
  <DemoPanel
    schema={panel.schema}
    values={panelValues}
    onParams={apply}
    hidden={[
      { name: pageParam, value: pagState().page },
      ...foreignParams.map(([fieldName, value]) => ({ name: fieldName, value })),
    ]}
    leading={storeField}
    footer={footer ? footerLine : undefined}
    class={className ?? 'rounded-xl border border-border bg-card p-4 text-sm shadow-sm'}
    {...(applyLabel !== undefined ? { applyLabel } : {})}
    {...(fallbackHint !== undefined ? { fallbackHint } : {})}
  />
{/key}
