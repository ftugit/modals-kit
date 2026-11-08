<script lang="ts">
  import Field from '#components/form/Field.svelte'
  import { defineForm, field } from '#lib/form/index.js'
  import { bind, createConfig, Form, type FieldComponent } from '#lib/form/svelte/index.js'
  import { untrack } from 'svelte'
  import { setModalsContext, type HostFloatingApi, type ModalsContext } from '#lib/modals/svelte/index.js'
  import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
  import FilterBlock from './FilterBlock.svelte'
  import FilterLabels from './FilterLabels.svelte'
  import { provideFilterBlocks } from './filter-blocks.svelte.js'

  let { floating, schema }: { floating?: HostFloatingApi; schema: CatalogFilterSchema } = $props()

  const api = untrack(() => floating)
  if (api) setModalsContext({ floating: api } as ModalsContext)
  provideFilterBlocks(() => ({ schema, prefix: 'page' }))

  const desc = defineForm({
    id: 'filter-block-harness',
    revision: 1,
    fields: {
      'page.filters.year.min': field.text({ label: 'от', defaultValue: '1990' }),
      'page.filters.year.max': field.text({ label: 'до', defaultValue: '1992' }),
      'page.filters.genres.and': field.text({ label: 'жанры', defaultValue: 'drama' }),
      'page.filters.studios.and': field.text({ label: 'студии', defaultValue: 'wit' }),
      'page.filters.kind': field.text({ label: 'тип', defaultValue: 'tv' }),
    },
  })
  const bound = bind(createConfig({ resolve: () => Field as unknown as FieldComponent }), desc)
</script>

<Form id="filter-block-form" form={bound} hiddenFields={bound.hidden()}>
  <FilterBlock>
    <Field of={bound.field('page.filters.year.min')} />
    <Field of={bound.field('page.filters.year.max')} />
  </FilterBlock>
  <FilterBlock>
    <Field of={bound.field('page.filters.genres.and')} />
    <Field of={bound.field('page.filters.studios.and')} />
  </FilterBlock>
  <Field of={bound.field('page.filters.kind')} />
</Form>
<FilterLabels />
