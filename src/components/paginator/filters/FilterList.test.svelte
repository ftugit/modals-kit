<script lang="ts">
  /**
   * Форма не ребёнок читателя реестра. Блок регистрируется по имени списка,
   * которое ставит сама форма.
   */
  import Field from '#components/form/Field.svelte'
  import { defineForm, field } from '#lib/form/index.js'
  import { bind, createConfig, Form, type FieldComponent } from '#lib/form/svelte/index.js'
  import FilterBlock from './FilterBlock.svelte'
  import { provideFilterList } from './filter-registry.svelte.js'

  provideFilterList('seed-users', {
    labels: { ord: 'Порядок', size: 'Элементов на страницу' },
  })

  const desc = defineForm({
    id: 'filter-list-harness',
    revision: 1,
    fields: {
      ord: field.text({ label: 'Порядок', defaultValue: 'id-asc' }),
      size: field.text({ label: 'Элементов на страницу', defaultValue: '50' }),
    },
  })
  const bound = bind(createConfig({ resolve: () => Field as unknown as FieldComponent }), desc)
</script>

<Form id="seed-form" form={bound} hiddenFields={bound.hidden()}>
  <FilterBlock>
    <Field of={bound.field('ord')} />
  </FilterBlock>
  <FilterBlock>
    <Field of={bound.field('ord')} />
    <Field of={bound.field('size')} />
  </FilterBlock>
</Form>
