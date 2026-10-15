<script lang="ts">
  // Ветка демо модалок (/modals): своя область (demoScope) и носители, которые
  // переключает панель демо. Выбор «память» здесь не трогает deep-link'и
  // остального сайта (решение оператора 2026-10-10) — у них своя ветка `(app)`.
  import { demoScope } from './registry'
  import { demoSources } from './sources.svelte'
  import ModalSystem from '../ModalSystem.svelte'

  let { children } = $props()
</script>

<ModalSystem scope={demoScope} sources={() => demoSources.list}>
  {@render children()}
</ModalSystem>
