<script lang="ts">
  import Field from '#core/ui/form/Field.svelte'
  import { defineForm, field } from '#core/lib/form/index.js'
  import { bind, createConfig, Form, type FieldComponent } from '#core/lib/form/svelte/index.js'
  import FilterBlock from './FilterBlock.svelte'
  import { provideFilterList } from './filter-registry.svelte.js'

  provideFilterList('placeholder-test', {
    labels: { genre: 'Жанры' },
  })

  const desc = defineForm({
    id: 'filter-block-placeholder-harness',
    revision: 1,
    fields: {
      genre: field.text({ label: 'Жанры', defaultValue: '11' }),
    },
  })
  const bound = bind(createConfig({ resolve: () => Field as unknown as FieldComponent }), desc)
</script>

<Form id="placeholder-form" form={bound} hiddenFields={bound.hidden()}>
  <FilterBlock>
    <Field of={bound.field('genre')} />
  </FilterBlock>
</Form>
