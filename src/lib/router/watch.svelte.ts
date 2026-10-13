/**
 * Наблюдатель за реактивным источником для кода ВНЕ компонента — слоя роутера
 * (`sveltekit.ts` — обычный модуль, рун там нет, а `page` из `$app/state`
 * реактивен). `$effect.root` — штатный способ завести эффект вне дерева
 * компонентов: https://svelte.dev/docs/svelte/$effect#$effect.root
 *
 * Своя копия, а не `#lib/modals/svelte/watch`: каждая библиотека работает
 * сама, роутер от модалок не зависит (модалки зависят от роутера).
 *
 * `read` отслеживается; `fn` вызывается через `untrack`. Первый прогон
 * (момент подписки) — не изменение, `fn` на нём не зовётся.
 */
import { untrack } from 'svelte'

export function watch(read: () => unknown, fn: () => void): () => void {
  let first = true
  return $effect.root(() => {
    $effect(() => {
      read()
      if (first) {
        first = false
        return
      }
      untrack(fn)
    })
  })
}
