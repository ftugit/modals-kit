<script lang="ts">
  // Выбор примитива по resolve — код приложения, один раз на проект.
  import type { Component as ComponentType } from 'svelte'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import { fieldViews } from './resolve'
  import Input from '#lib/components/ui/input/Input.svelte'
  // Связь «подмена → её база»: декларация — module-экспорт `base` в самом файле
  // подмены (см. `CopyField`). Компилятор Svelte named-экспорты module-скрипта
  // на функцию-компонент НЕ вешает (`CopyField.base` — всегда undefined), поэтому
  // связь читается здесь, в месте проверки, named-импортом. Новая подмена —
  // строка реестра + module-экспорт `base` в её файле.
  import CopyField, { base as copyBase } from './CopyField.svelte'

  // `of` может быть пустым: поля нет у источника (студии у GraphQL) — не рисуем.
  // Набор полей от пользователя (`field.fields`) умолчания не имеет: места, цикл и кнопки
  // расставляет приложение через `fieldSet` (`#lib/form/svelte`) — здесь он не рисуется.
  //
  // Подмена примитива (`instead`, решение владельца, ход 261): компонент, которым страница
  // заменяет выбор resolve. Защита — по декларации базы: подмена включается, только если
  // её `base` — примитив `Input` (поле + свои кнопки/действия); всё прочее (button,
  // карточка, select) подмену не включает — поле остаётся полем. Значения, проверки и
  // отправку подмена не затрагивает: `FieldView` у подменённого компонента тот же.
  let {
    of,
    instead,
  }: { of: FieldView | undefined; instead?: ComponentType<FieldView> } = $props()

  const BASE_OF = new Map<object, unknown>([[CopyField, copyBase]])

  const substitute = $derived(of && instead && BASE_OF.get(instead) === Input ? instead : null)
  const Component = $derived(
    of && of.input !== 'fields' ? (substitute ?? fieldViews.resolveView(of)) : undefined,
  )
</script>

{#if of && Component}<Component {...of} />{/if}
