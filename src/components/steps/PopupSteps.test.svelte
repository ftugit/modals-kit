<script lang="ts">
  import Field from '../form/Field.svelte'
  import { defineForm, field } from '#lib/form/index.js'
  import { bind, createConfig, Form, type FieldComponent } from '#lib/form/svelte/index.js'
  import { untrack } from 'svelte'
  import { setModalsContext, type HostFloatingApi, type ModalsContext } from '#lib/modals/svelte/index.js'
  import PopupSteps from './PopupSteps.svelte'
  import type { StepsHost } from './steps.svelte.js'

  let { steps, floating }: { steps: StepsHost; floating?: HostFloatingApi } = $props()

  const api = untrack(() => floating)
  if (api) setModalsContext({ floating: api } as ModalsContext)

  const desc = defineForm({
    id: 'popup-steps-harness',
    revision: 1,
    fields: {
      alpha: field.text({ label: 'Альфа', defaultValue: 'from-alpha' }),
      beta: field.text({ label: 'Бета', defaultValue: 'from-beta' }),
    },
  })
  const bound = bind(createConfig({ resolve: () => Field as unknown as FieldComponent }), desc)
</script>

<Form id="popup-form" form={bound} hiddenFields={bound.hidden()}>
  <PopupSteps host={steps} label="Срезы" name="t">
    {#snippet alpha()}<Field of={bound.f.alpha} />{/snippet}
    {#snippet beta()}<Field of={bound.f.beta} />{/snippet}
  </PopupSteps>
</Form>
