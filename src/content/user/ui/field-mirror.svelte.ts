// Зеркало внешнего значения в поле формы (уроки хода 261). ДВА грабля, на
// которые наступали, спрятаны здесь:
//   1) view нельзя доставать ВНУТРИ эффекта — чтение `bound` замыкает эффект
//      на состояние формы, и любой ввод перетирается зеркалом;
//   2) SSR и no-JS рендер читают состояние формы (эффекты на сервере не идут),
//      поэтому стартовое значение пишется синхронно и без реактивности —
//      иначе seed не виден в HTML страницы.
// Вызов — при инициализации компонента ($effect внутри требует init-контекста).
import { untrack } from 'svelte'
import type { BoundForm } from '#lib/form/svelte/index.js'

export function mirrorToField(
  bound: Pick<BoundForm, 'field'>,
  name: string,
  value: () => unknown,
): void {
  const view = bound.field(name)
  const initial = untrack(value)
  if (initial !== '' && initial !== undefined && initial !== null) {
    untrack(() => view?.onInput(initial))
  }
  $effect(() => {
    view?.onInput(value())
  })
}
