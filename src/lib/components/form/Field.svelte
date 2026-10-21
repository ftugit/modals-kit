<script lang="ts">
  // Выбор примитива по resolve — код приложения, один раз на проект.
  import { untrack, type Component as ComponentType } from 'svelte'
  import { DEV } from 'esm-env'
  import {
    FIELD_HANDLE,
    type FieldHandle,
    type FieldTakeover,
    type FieldTakeoverMount,
    type FieldView,
  } from '#lib/form/svelte/index.js'
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
  //
  // Перехват поля (`takeover`): callback у конкретного поля. Вызывается один раз
  // после оживления с живой ручкой поля (`f.value`/`f.onInput`/`f.errors` +
  // свойства-писатели `f.error`/`f.pending`); возврат может заменить видимый
  // компонент — замена включается, только если её `base` совпал с примитивом
  // resolve для этого поля, и получает ту же ручку пропом `f`. `instead` из
  // разметки сильнее перехвата: разметка — ближайшее слово автора. До
  // оживления и без JS поле штатное; сервер перехвата не видит.
  let {
    of,
    instead,
    takeover,
  }: {
    of: FieldView | undefined
    instead?: ComponentType<FieldView>
    takeover?: FieldTakeover
  } = $props()

  const BASE_OF = new Map<object, unknown>([[CopyField, copyBase]])

  // Живая ручка поля: bind вешает её на снимок символьным ключом (FIELD_HANDLE).
  const handle = $derived(
    of ? (of as unknown as Record<symbol, FieldHandle | undefined>)[FIELD_HANDLE] : undefined,
  )

  let mount = $state<FieldTakeoverMount | null>(null)
  let handleWarned = false
  const fieldName = $derived(of?.name)
  $effect(() => {
    // Зависимость — только имя поля: инлайн-callback меняет идентичность на
    // каждой отрисовке родителя, перехват от этого не пересоздаётся.
    const name = fieldName
    if (!name) return
    return untrack(() => {
      if (!takeover || of?.input === 'fields') return
      const f = handle
      if (!f) {
        if (DEV && !handleWarned) {
          handleWarned = true
          console.warn(
            '[Field] takeover не включён: поле не несёт живой ручки связки. ' +
              'Передавайте в `of` вид поля из bind (`bound.f.<поле>`), а не собранный вручную объект.',
          )
        }
        return
      }
      let m: FieldTakeoverMount | void
      try {
        m = takeover(f)
      } catch (err) {
        // Упавший перехватчик форму не роняет: поле остаётся штатным.
        if (DEV) console.error(`[Field] takeover поля '${name}' упал при монтировании:`, err)
        return
      }
      mount = m ?? null
      return () => {
        mount = null
        try { m?.dispose?.() } catch { /* уборка форму не роняет */ }
      }
    })
  })

  const substitute = $derived(of && instead && BASE_OF.get(instead) === Input ? instead : null)
  const resolved = $derived(of && of.input !== 'fields' ? fieldViews.resolveView(of) : undefined)
  const Taken = $derived(
    !substitute && mount?.view && resolved && mount.base === resolved ? mount.view : null,
  )
  const Component = $derived(
    of && of.input !== 'fields' && !Taken ? (substitute ?? resolved) : undefined,
  )

  // Та же ловушка тихого отказа, что у `instead`: замена перехватчика с чужим
  // `base` молча не включилась бы — в dev предупреждаем с рецептом.
  let takeoverWarned = false
  $effect(() => {
    if (DEV && !takeoverWarned && mount?.view && resolved && !Taken && !substitute) {
      takeoverWarned = true
      console.warn(
        '[Field] замена перехватчика не включена: `base` не совпал с примитивом, ' +
          'который resolve дал этому полю. Верните из takeover base — ровно тот ' +
          'компонент кита, что стоит в resolve.ts для этого представления поля.',
      )
    }
  })

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

{#if of && Taken && handle}<Taken f={handle} />{:else if of && Component}<Component {...of} />{/if}
