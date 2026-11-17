<script lang="ts">
  import { defineForm, field, v } from '#core/lib/form/index.js'
  import { setModalsContext, type HostFloatingApi, type ModalsContext } from '#core/lib/modals/svelte/index.js'
  import type { CatalogFilterDescribe, CatalogFilterSchema } from '#core/lib/paginate/filters/index.js'
  import { PaginatorScope } from '#core/lib/paginate/svelte/index.js'
  import type { Store } from '#core/lib/paginate/index.js'
  import FiltersPanel from './FiltersPanel.svelte'
  import TestForm from './FiltersPanel.test.svelte'

  let { store, name, extra }: { store: Store; name: string; extra: Record<string, unknown> } = $props()

  const schema: CatalogFilterSchema = {
    source: 'filters-panel-test',
    version: 1,
    fields: [
      { key: 'q', label: 'Поиск', type: 'text' },
    ],
  }

  const describe: CatalogFilterDescribe = (_schema, opts) => {
    const prefix = opts?.prefix ?? ''
    return defineForm({
      id: 'filters-panel-test-form',
      fields: {
        [`${prefix}filters.q`]: field.text({ label: 'Поиск', validate: [v.required()] }),
      },
    })
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
</script>

<PaginatorScope {store}>
  <FiltersPanel
    {name}
    {schema}
    {extra}
    {describe}
    form={TestForm}
    url="/catalog"
    search={{}}
  />
</PaginatorScope>
