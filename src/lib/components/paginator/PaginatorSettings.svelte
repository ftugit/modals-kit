<script lang="ts" generics="V extends Record<string, import('#lib/paginate/index.js').ExtraValue> = Record<string, import('#lib/paginate/index.js').ExtraValue>">
  /**
   * Панель настроек пагинатора — на универсальном `DemoPanel` (этап 2).
   *
   * Здесь осталось ровно то, что знает домен пагинатора: имя экземпляра,
   * его хранилище (`setExtra`/`setPageSize`), выбор хранилища (поле схемы
   * панели, не ручной контрол: имя и значение даёт bind панели), подвал
   * и слот нативной GET (указатель страницы + чужие ключи). Схема полей,
   * форма, «Применить» до оживления, hidden-пары тумблеров — панели.
   *
   * Адрес панель не пишет: все поля `url: false`, ключами `page`/`page.*`
   * владеет адаптер источника. Он же читает их из адреса при загрузке —
   * поэтому панель отдаёт значения параметрами, а не строит ссылку.
   */
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { currentPathname, currentSearch } from '#lib/paginate/sveltekit/router.js'
  import { featureGates, getPaginator, type Extra, type ExtraValue } from '#lib/paginate/index.js'
  import { usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import { DemoPanel, demoSelect } from '#lib/components/demo/index.js'
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

  /**
   * Выбор хранилища — первое поле СХЕМЫ панели (не ручной контрол с
   * собственным name): имя и значение даёт bind панели, до оживления
   * поле выключено (`jsOnly` — смена хранилища клиентская операция).
   * В патч пагинатора оно не ходит (`toPatch` идёт по своей meta и ключа
   * `store` в ней нет): смену из `apply` забирает владелец пропа.
   */
  const schema = $derived(
    storeProp
      ? {
          ...panel.schema,
          fields: [
            demoSelect({
              key: 'store',
              label: storeProp.label ?? 'Хранилище настроек и страницы',
              url: false,
              jsOnly: true,
              defaultValue: storeProp.options[0]?.[0] ?? '',
              options: storeProp.options.map(([value, label]) => ({ value, label })),
            }),
            ...panel.schema.fields,
          ],
        }
      : panel.schema,
  )

  /** Значения панели — зеркало хранилища: панель догоняет его сама (`values`). */
  const panelValues = $derived({
    ...panel.toPanel(currentValues, pagState().pageSize),
    ...(storeProp ? { store: storeProp.value } : {}),
  })

  /**
   * Пересоздание формы — только когда меняется ЕЁ состав: источник (гаты),
   * префикс адреса, адрес действия. Смена страницы/значений — не повод
   * терять фокус.
   */
  const panelKey = $derived(
    `${action}|${pageParam}|${storeProp ? 'store' : '-'}|${Object.entries(gates)
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
    // выбор хранилища — не патч пагинатора: смену забирает владелец пропа
    // (toPatch ключ store пропустит — в его meta такого поля нет)
    if ('store' in changed && storeProp) {
      const next = String(changed['store'])
      if (next !== '' && next !== storeProp.value) storeProp.onChange(next)
    }
    const { extra, size } = panel.toPatch(changed)
    if (Object.keys(extra).length > 0) void setExtra(extra)
    if (size !== undefined && size !== pagState().pageSize) void setPageSize(size)
  }
</script>

{#snippet footerLine()}
  {@render footer?.({ pageSize: pagState().pageSize, page: pagState().page })}
{/snippet}

{#key panelKey}
  <DemoPanel
    schema={schema}
    values={panelValues}
    onParams={apply}
    hidden={[
      { name: pageParam, value: pagState().page },
      ...foreignParams.map(([fieldName, value]) => ({ name: fieldName, value })),
    ]}
    footer={footer ? footerLine : undefined}
    class={className ?? 'rounded-xl border border-border bg-card p-4 text-sm shadow-sm'}
    {...(applyLabel !== undefined ? { applyLabel } : {})}
    {...(fallbackHint !== undefined ? { fallbackHint } : {})}
  />
{/key}
