<script lang="ts">
  /**
   * Форма фильтров списка устройств — одна на sidebar, модалку и
   * `/user/sessions/filters`.
   *
   * С JS применение — `onApply` → `setExtra`. Без JS (и на странице фильтров)
   * форма уходит POST; сервер собирает адрес адаптером из `from` и отвечает
   * 303. GET форма не пишет: формат адреса знает хранилище.
   */
  import { onMount, untrack } from 'svelte'
  import { Form } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import FilterBlock from '#components/paginator/filters/FilterBlock.svelte'
  import { provideFilterList } from '#components/paginator/filters/filter-registry.svelte.js'
  import { Button } from '#components/ui/index.js'
  import { asLink } from '#hooks/links/index.js'
  import { mirrorToField } from './field-mirror.svelte.js'
  import { SESSIONS_NAME } from './sessions-list/source.js'
  import {
    applySessionsFilters,
    sessionsFilterLabels,
    sessionsFiltersForm,
    type SessionsFilterValues as SessionsFilterValuesType,
  } from './sessions-list/filters-form.js'

  export type SessionsFilterValues = SessionsFilterValuesType

  interface Props {
    canSeeDeleted: boolean
    /** Коды стран из среза (и `none` для «Неизвестно»). */
    countries: readonly string[]
    initial: SessionsFilterValues
    /** Адрес списка (путь и search), куда без JS вернёт 303. */
    from?: string
    /** Адрес списка без фильтров — «Сбросить» без JS. */
    resetHref?: string
    onApply?: (patch: Record<string, string | undefined>, pageSize: number) => void | Promise<void>
    onReset?: () => void | Promise<void>
  }

  let {
    canSeeDeleted,
    countries,
    initial,
    from = '',
    resetHref,
    onApply,
    onReset,
  }: Props = $props()

  // Имя списка, не контекст `Listing`: форма рисуется в sidebar и в модалке.
  provideFilterList(SESSIONS_NAME, { labels: sessionsFilterLabels() })

  const init = untrack(() => initial)
  const codes = untrack(() => countries)
  // Право и пункты фиксируются при создании формы: компонент пересоздаётся
  // ключом снаружи (`{#key …}`), а не меняет состав полей на лету.
  const bound = bindComponentForm(forms, sessionsFiltersForm(codes, untrack(() => canSeeDeleted)))
  const failed = untrack(() => Boolean(bound.state.result && !bound.state.result.ok))

  // Скрытое `from` — адрес списка для 303 без JS.
  mirrorToField(bound, 'from', () => from)
  if (!failed) {
    mirrorToField(bound, 'state', () => init.state)
    mirrorToField(bound, 'size', () => init.size)
    mirrorToField(bound, 'net', () => init.net)
    if (untrack(() => codes.length)) mirrorToField(bound, 'country', () => init.country)
    mirrorToField(bound, 'cfrom', () => init.cfrom)
    mirrorToField(bound, 'cto', () => init.cto)
    mirrorToField(bound, 'sfrom', () => init.sfrom)
    mirrorToField(bound, 'sto', () => init.sto)
  }

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  let rangeError = $state('')

  function submit(e: SubmitEvent) {
    if (!hydrated || !onApply) return
    e.preventDefault()
    const applied = applySessionsFilters(bound.values, { canSeeDeleted })
    if (!applied.ok) {
      rangeError = applied.message
      return
    }
    rangeError = ''
    void onApply(applied.patch, applied.pageSize)
  }
</script>

<Form
  form={bound}
  onsubmit={submit}
  hiddenFields={bound.hidden()}
  class="flex flex-col gap-4"
  data-testid="sessions-filters-form"
>
  <div hidden aria-hidden="true">
    <Field of={bound.field('paginator')!} />
    <Field of={bound.field('page_param')!} />
    <Field of={bound.field('from')!} />
  </div>
  <Common errors={bound.common} />
  <div class="flex flex-wrap gap-3">
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="state">
        <Field of={bound.field('state')!} />
      </div>
    </FilterBlock>
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="size">
        <Field of={bound.field('size')!} />
      </div>
    </FilterBlock>
  </div>
  <FilterBlock>
    <Field of={bound.field('net')!} />
  </FilterBlock>
  {#if codes.length}
    <FilterBlock>
      <div data-filter-segment="country">
        <Field of={bound.field('country')!} />
      </div>
    </FilterBlock>
  {/if}
  <div class="flex flex-wrap gap-3">
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="cfrom">
        <Field of={bound.field('cfrom')!} />
      </div>
    </FilterBlock>
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="cto">
        <Field of={bound.field('cto')!} />
      </div>
    </FilterBlock>
  </div>
  <div class="flex flex-wrap gap-3">
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="sfrom">
        <Field of={bound.field('sfrom')!} />
      </div>
    </FilterBlock>
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="sto">
        <Field of={bound.field('sto')!} />
      </div>
    </FilterBlock>
  </div>
  {#if rangeError}
    <p class="text-sm text-destructive" role="alert">{rangeError}</p>
  {/if}
  <div class="flex items-center justify-between gap-3 pt-1">
    {#if onReset}
      <Button type="button" variant="ghost" onclick={() => void onReset()}>Сбросить</Button>
    {:else if resetHref}
      <Button {...asLink(resetHref)} variant="ghost">Сбросить</Button>
    {:else}
      <span></span>
    {/if}
    <Button type="submit">Применить</Button>
  </div>
</Form>
