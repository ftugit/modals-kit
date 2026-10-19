<script lang="ts">
  // Выбор примитива по resolve — код приложения, один раз на проект.
  import type { Component as ComponentType } from 'svelte'
  import { DEV } from 'esm-env'
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

  // Ловушка тихого отказа подмены (ход 261): `instead` без декларации базы
  // молча давал обычный resolve — с этого началась многочасовая диагностика
  // («почему поле не то»). В dev предупреждаем с рецептом; один раз на компонент.
  let insteadWarned = false
  $effect(() => {
    if (DEV && !insteadWarned && of && instead && !substitute) {
      insteadWarned = true
      console.warn(
        '[Field] вместо подмены рисуется обычный resolve: у компонента из `instead` ' +
          'нет записи в реестре BASE_OF. В module-скрипте файла подмены объявите ' +
          'базу (export const base = Input) и добавьте строку ' +
          '[[Компонент, base]] в Map BASE_OF в Field.svelte.',
      )
    }
  })
</script>

{#if of && Component}<Component {...of} />{/if}
