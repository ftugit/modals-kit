<script lang="ts" generics="V extends Record<string, import('#lib/paginate/index.js').ExtraValue> = Record<string, import('#lib/paginate/index.js').ExtraValue>">
  import { untrack } from 'svelte'
  /**
   * Оболочка панели настроек пагинатора: строит компилированное описание
   * (`./compile`) и держит только то, что компилироваться не может —
   * гидратацию и слот хранилища. Разметку и живое связывание несёт
   * `PaginatorSettingsForm` (механизм `lib/form`, `commit: 'live'`).
   *
   * Публичный контракт (пропсы `fields`/`pageSizes`/`values`/`store`/`footer`…)
   * НЕ изменился — панель по-прежнему «схема → render»: список
   * `SettingsField` описывает поля, имена адресов, выключения и маппинг в
   * extra; `fieldState()`-функция из оболочки ушла — решение о выключении
   * считается компилятором (гаты), механизмом (гидратация) и `lib/links`
   * (связки `enabledBy`), а показывает его `FieldView`.
   */
  import { currentPathname, currentSearch } from '#lib/router/sveltekit.js'
  import { featureGates, getPaginator, type Extra, type ExtraValue } from '#lib/paginate/index.js'
  import { usePaginatorActions, usePaginatorState } from '#lib/paginate/svelte/index.js'
  import type { Snippet } from 'svelte'
  import { compileDemoPanelSchema } from './compile'
  import type { SettingsField } from './types'
  import PaginatorSettingsForm from './PaginatorSettingsForm.svelte'

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
    noscriptHint?: string
  }

  let {
    name: nameProp,
    pageSizes,
    fields = [],
    values: valuesMapper,
    store,
    footer,
    class: className,
    applyLabel,
    noscriptHint,
  }: Props<V> = $props()
  // Имя пагинатора — идентичность экземпляра: читается один раз при монтировании.
  // Другое имя = другой пагинатор; пересоздаёт компонент родитель (`{#key}`).
  const name = untrack(() => nameProp)

  const pagState = usePaginatorState(name)
  const { setExtra, setPageSize } = usePaginatorActions(name)

  const pageParam = $derived(
    getPaginator(pagState().name).adapter.pageParam ?? 'page',
  )

  /**
   * Возможности текущего источника — серверные данные: чем источник не
   * умеет — тем панель не управляет (поле гасится СТАТИЧЕСКИ при компиляции,
   * с причиной). Переключение источника обновляет их само.
   */
  const gates = $derived(featureGates(pagState().capabilities))

  const currentValues = $derived(
    valuesMapper ? valuesMapper(pagState().extra) : (pagState().extra as V),
  )

  // Чужие ключи адреса — через слой фреймворка (канон: панель читает
  // `app.search`), а не `window.location.search`: прямое чтение адреса не
  // даёт `$derived` зависимостей, и копии чужих ключей застывали.
  const foreignParams = $derived.by((): [string, string][] => {
    const base = pageParam
    const out: [string, string][] = []
    for (const [k, v] of Object.entries(currentSearch())) {
      if (k === base || k.startsWith(`${base}.`)) continue
      out.push([k, String(v)])
    }
    return out
  })

  const schema = $derived(
    compileDemoPanelSchema<V>({
      pageParam,
      pageSizes,
      fields,
      gates,
    }),
  )
</script>

{#key schema}
  <PaginatorSettingsForm
    {schema}
    {pageParam}
    page={pagState().page}
    foreign={foreignParams}
    action={currentPathname()}
    values={currentValues}
    pageSize={pagState().pageSize}
    onExtra={(patch) => setExtra(patch)}
    onSize={(n) => setPageSize(n)}
    {store}
    {footer}
    class={className}
    {applyLabel}
    {noscriptHint}
  />
{/key}
