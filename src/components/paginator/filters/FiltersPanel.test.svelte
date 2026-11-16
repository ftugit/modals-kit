<script lang="ts">
  import { Form } from '#lib/form/svelte/index.js'
  import Field from '#components/form/Field.svelte'
  import { bindFilters, FilterActions, FilterBlock, type FilterFormProps } from '#components/paginator/index.js'

  let props: FilterFormProps = $props()
  const filters = bindFilters(() => props)
</script>

<Form form={filters.form} hiddenFields={props.hidden} data-testid="catalog-filter-form">
  <FilterBlock><Field of={filters.f.q} /></FilterBlock>
  <FilterActions resetHref={props.resetHref} onReset={props.onReset} />
</Form>
