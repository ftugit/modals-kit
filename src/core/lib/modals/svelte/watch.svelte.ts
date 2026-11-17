/**
 * Наблюдатель за реактивным источником для кода ВНЕ компонента.
 *
 * Нужен слою фреймворка, который сам — обычный модуль (ядро среды
 * `cores/sveltekit.ts`): там руны недоступны, а состояние фреймворка
 * (`page` из `$app/state`) реактивно. `$effect.root` — штатный способ завести
 * эффект вне дерева компонентов, с ручным уничтожением:
 * https://svelte.dev/docs/svelte/$effect#$effect.root
 *
 * `read` отслеживается; `fn` вызывается через `untrack` — его собственные
 * чтения подписку не расширяют. Первый прогон эффекта (момент подписки) —
 * не изменение, поэтому `fn` на нём не зовётся.
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
