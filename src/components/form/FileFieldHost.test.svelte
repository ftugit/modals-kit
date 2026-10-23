<script lang="ts">
  import { Form, type BoundForm } from '#lib/form/svelte/index.js'
  import Field from './Field.svelte'

  let { bound }: { bound: BoundForm } = $props()
</script>

<Form form={bound} hiddenFields={bound.hidden()}>
  <Field of={bound.f.cover} />
  <Field of={bound.f.docs} />
  <Field of={bound.f.gallery} />
</Form>
