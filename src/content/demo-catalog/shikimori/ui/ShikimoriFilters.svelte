<script lang="ts">
  /**
   * Фильтры каталога Shikimori: поля расставлены руками, как в обычной форме.
   * Подписи, варианты и правила — в описании `shikimoriFilterForm`; здесь —
   * только где что стоит. Поля, которого у API нет (студии у GraphQL), нет и
   * в форме: `Field` с пустым `of` ничего не рисует.
   */
  import { Form } from '#lib/form/svelte/index.js'
  import Field from '#components/form/Field.svelte'
  import { bindFilters, FilterActions, type FilterFormProps } from '#components/paginator/index.js'

  let props: FilterFormProps = $props()
  const filters = bindFilters(() => props)
  const studiosCut = $derived(filters.truncated('studios'))
</script>

<Form form={filters.form} hiddenFields={props.hidden} data-testid="catalog-filter-form" class="flex flex-col gap-4">
  <div class="grid gap-3 sm:grid-cols-2">
    <Field of={filters.f['genres.and']} />
    <Field of={filters.f['genres.not']} />
    <Field of={filters.f['studios.and']} />
    <Field of={filters.f['studios.not']} />
    {#if studiosCut && filters.f['studios.and']}
      <p class="text-xs text-muted-foreground sm:col-span-2" data-testid="filters-studios-cut">
        Источник прислал не все студии: ещё {studiosCut} не показаны.
      </p>
    {/if}
    <Field of={filters.f.kind} />
    <Field of={filters.f.status} />
    <Field of={filters.f.rating} />
    <Field of={filters.f.duration} />
    <Field of={filters.f['score.min']} />
    <div class="grid grid-cols-2 gap-3">
      <Field of={filters.f['year.min']} />
      <Field of={filters.f['year.max']} />
    </div>
  </div>
  <FilterActions resetHref={props.resetHref} onReset={props.onReset} />
</Form>
