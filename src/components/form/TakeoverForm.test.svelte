<script lang="ts">
  // Фикстура тестов Field.takeover: настоящая форма с двумя полями;
  // у doc — перехват и/или подмена из пропсов.
  import type { Component } from 'svelte'
  import { Form, type BoundForm, type FieldTakeover, type FieldView } from '#lib/form/svelte/index.js'
  import Field from './Field.svelte'

  let { bound, takeover, instead }: {
    bound: BoundForm
    takeover?: FieldTakeover
    instead?: Component<FieldView>
  } = $props()
</script>

<Form form={bound} hiddenFields={bound.hidden()}>
  <Field of={bound.f.doc} {takeover} {instead} />
  <Field of={bound.f.note} />
</Form>
