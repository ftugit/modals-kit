<script lang="ts">
  // Выбор примитива по resolve — код приложения, один раз на проект.
  import type { FieldView } from '#lib/form/svelte/index.js'
  import { forms } from '../forms.config'

  let { of }: { of: FieldView } = $props()
  const Component = $derived(forms.resolveView(of))
</script>

<Component {...of} />
