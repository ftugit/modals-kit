<script lang="ts">
  // Выбор примитива по resolve — код приложения, один раз на проект.
  import type { FieldView } from '#lib/form/svelte/index.js'
  import { fieldViews } from './resolve'

  // `of` может быть пустым: поля нет у источника (студии у GraphQL) — не рисуем.
  // Набор полей от пользователя (`field.fields`) умолчания не имеет: места, цикл и кнопки
  // расставляет приложение через `fieldSet` (`#lib/form/svelte`) — здесь он не рисуется.
  let { of }: { of: FieldView | undefined } = $props()
  const Component = $derived(of && of.input !== 'fields' ? fieldViews.resolveView(of) : undefined)
</script>

{#if of && Component}<Component {...of} />{/if}
