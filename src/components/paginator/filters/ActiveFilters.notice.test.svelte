<script lang="ts">
  import Field from '#components/form/Field.svelte'
  import { defineForm, field } from '#lib/form/index.js'
  import { bind, createConfig, Form, type FieldComponent } from '#lib/form/svelte/index.js'
  import { setModalsContext, type HostFloatingApi, type ModalsContext } from '#lib/modals/svelte/index.js'
  import { catalogFilterView, type CatalogFilterSchema } from '#lib/paginate/filters/index.js'
  import type { FormError } from '#lib/form/result.js'
  import ActiveFilters from './ActiveFilters.svelte'
  import FilterBlock from './FilterBlock.svelte'
  import { provideFilterBlocks } from './filter-blocks.svelte.js'

  let {
    extra,
    notice = 'В наборе несколько значений, выберите одно.',
    onRemoveGroup,
    onCommitDraft,
  }: {
    extra: Record<string, unknown>
    notice?: string
    onRemoveGroup?: (patch: Record<string, unknown>) => void
    onCommitDraft?: (form: HTMLFormElement) => readonly FormError[] | void
  } = $props()

  const statuses = [
    { value: 'alive', label: 'Жив' },
    { value: 'dead', label: 'Мёртв' },
  ]
  const kinds = [
    { value: 'tv', label: 'Сериал' },
    { value: 'movie', label: 'Фильм' },
  ]

  const schema: CatalogFilterSchema = {
    source: 'active-filters-notice-test',
    version: 1,
    fields: [
      { key: 'status', label: 'Статус', type: 'select', options: statuses },
      { key: 'kind', label: 'Тип', type: 'select', options: kinds },
      { key: 'score', label: 'Оценка', type: 'number', bounds: ['min', 'max'] },
      { key: 'genres', label: 'Жанры', type: 'multiselect', modes: ['and', 'not'] },
    ],
  }

  const floating = (() => {
    let node: HTMLElement | undefined
    const open = () => {
      node = document.createElement('div')
      document.body.append(node)
      return 'floating'
    }
    return {
      open,
      openFlow: open,
      update: () => {},
      close: () => {
        node?.remove()
        node = undefined
      },
      container: () => node,
    } satisfies HostFloatingApi
  })()

  setModalsContext({ floating } as unknown as ModalsContext)
  provideFilterBlocks(() => ({ schema, prefix: 'page' }))

  const desc = defineForm({
    id: 'active-filters-notice-test-form',
    revision: 1,
    fields: {
      'page.filters.status': field.select({ label: 'Статус', options: statuses }),
      'page.filters.kind': field.select({ label: 'Тип', options: kinds }),
      'page.filters.score.min': field.text({ label: 'Оценка от' }),
      'page.filters.score.max': field.text({ label: 'Оценка до' }),
      'page.filters.genres.and': field.text({ label: 'Жанры' }),
    },
  })
  const bound = bind(createConfig({ resolve: () => Field as unknown as FieldComponent }), desc)
  const view = $derived(catalogFilterView(schema, extra, { description: desc, prefix: 'page' }))
</script>

<Form id="active-filters-notice-test-form" form={bound} hiddenFields={bound.hidden()}>
  <FilterBlock>
    <Field of={bound.field('page.filters.status')} />
  </FilterBlock>
  <FilterBlock>
    <Field of={bound.field('page.filters.kind')} />
  </FilterBlock>
  <FilterBlock>
    <Field of={bound.field('page.filters.score.min')} />
    <Field of={bound.field('page.filters.score.max')} />
  </FilterBlock>
  <FilterBlock>
    <Field of={bound.field('page.filters.genres.and')} />
  </FilterBlock>
</Form>

<ActiveFilters
  chips={view.chips}
  count={view.count}
  singleValueNotice={notice}
  onRemoveGroup={onRemoveGroup}
  {onCommitDraft}
/>
