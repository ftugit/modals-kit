<script lang="ts">
  /**
   * Фильтры персонажей Rick and Morty: два выбора и два текстовых поля.
   * Подписи и варианты — в описании `rickMortyFilterForm`.
   */
  import { Form } from '#lib/form/svelte/index.js'
  import Field from '#lib/components/form/Field.svelte'
  import { bindFilters, FilterActions, type FilterFormProps } from '#lib/components/filters/index.js'

  let props: FilterFormProps = $props()
  const filters = bindFilters(() => props)
</script>

<Form form={filters.form} hiddenFields={props.hidden} data-testid="catalog-filter-form" class="space-y-4">
  <div class="grid gap-3 sm:grid-cols-2">
    <Field of={filters.f.status} />
    <Field of={filters.f.gender} />
    <Field of={filters.f.species} />
    <Field of={filters.f.type} />
  </div>
  <FilterActions resetHref={props.resetHref} />
</Form>
