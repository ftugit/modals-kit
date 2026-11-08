<script lang="ts">
  /**
   * Форма фильтров списка seed-юзеров — одна на sidebar, модалку и
   * `/users/filters`.
   *
   * С JS применение — `onApply` → `setExtra`. Без JS (и на странице
   * фильтров) форма уходит POST; сервер собирает адрес адаптером из `from`
   * и отвечает 303. GET форма не пишет: формат адреса знает хранилище.
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
  import {
    applySeedFilters,
    seedFilterLabels,
    seedUsersFiltersForm,
    type SeedUsersFilterValues as SeedUsersFilterValuesType,
  } from './seed-users/filters-form.js'
  import { SEED_USERS_NAME } from './seed-users/source.js'

  export type SeedUsersFilterValues = SeedUsersFilterValuesType

  interface Props {
    canSeeDeleted: boolean
    canSeeNickname?: boolean
    initial: SeedUsersFilterValues
    /** Адрес списка (путь и search), куда без JS вернёт 303. */
    from?: string
    /** Адрес списка без фильтров — «Сбросить» без JS. */
    resetHref?: string
    onApply?: (patch: Record<string, string | undefined>, pageSize: number) => void | Promise<void>
    onReset?: () => void | Promise<void>
  }

  let {
    canSeeDeleted,
    canSeeNickname = false,
    initial,
    from = '',
    resetHref,
    onApply,
    onReset,
  }: Props = $props()

  // Имя списка, не контекст `Listing`: форма рисуется в sidebar и в модалке.
  provideFilterList(SEED_USERS_NAME, { labels: seedFilterLabels() })

  const init = untrack(() => initial)
  const bound = bindComponentForm(forms, seedUsersFiltersForm)
  const failed = untrack(() => Boolean(bound.state.result && !bound.state.result.ok))

  mirrorToField(bound, 'show_deleted', () => canSeeDeleted)
  mirrorToField(bound, 'from', () => from)
  if (!failed) {
    mirrorToField(bound, 'ord', () => init.ord)
    mirrorToField(bound, 'size', () => init.size)
    mirrorToField(bound, 'state', () => init.state)
    mirrorToField(bound, 'cfrom', () => init.cfrom)
    mirrorToField(bound, 'cto', () => init.cto)
    if (untrack(() => canSeeNickname)) mirrorToField(bound, 'nick', () => init.nick)
    if (untrack(() => canSeeDeleted)) {
      mirrorToField(bound, 'dfrom', () => init.dfrom)
      mirrorToField(bound, 'dto', () => init.dto)
    }
  }

  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })

  let rangeError = $state('')

  function submit(e: SubmitEvent) {
    if (!hydrated || !onApply) return
    e.preventDefault()
    const applied = applySeedFilters(bound.values, {
      canSeeDeleted,
      canSeeNickname,
    })
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
  data-testid="seed-users-filters-form"
>
  <div hidden aria-hidden="true">
    <Field of={bound.field('paginator')!} />
    <Field of={bound.field('page_param')!} />
    <Field of={bound.field('from')!} />
    <Field of={bound.field('show_deleted')!} />
  </div>
  <Common errors={bound.common} />
  <div class="flex flex-wrap gap-3">
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="ord">
        <Field of={bound.field('ord')!} />
      </div>
    </FilterBlock>
    <FilterBlock>
      <div class="min-w-0 flex-1 basis-44" data-filter-segment="size">
        <Field of={bound.field('size')!} />
      </div>
    </FilterBlock>
  </div>
  {#if canSeeNickname}
    <FilterBlock>
      <Field of={bound.field('nick')!} />
    </FilterBlock>
  {/if}
  {#if canSeeDeleted}
    <FilterBlock>
      <Field of={bound.field('state')!} />
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
  {#if canSeeDeleted}
    <div class="flex flex-wrap gap-3">
      <FilterBlock>
        <div class="min-w-0 flex-1 basis-44" data-filter-segment="dfrom">
          <Field of={bound.field('dfrom')!} />
        </div>
      </FilterBlock>
      <FilterBlock>
        <div class="min-w-0 flex-1 basis-44" data-filter-segment="dto">
          <Field of={bound.field('dto')!} />
        </div>
      </FilterBlock>
    </div>
  {/if}
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
