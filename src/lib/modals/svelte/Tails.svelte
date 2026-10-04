<script lang="ts">
  // Хвосты — пустые обманки нужного цвета, чуть меньше активной оболочки.
  // Порт `Tails` из `stack.tsx`.
  //
  // В оригинале приходилось держать Map стабильных слотов, чтобы `For`
  // не пересоздавал существующие хвосты при росте цепочки (иначе терялось
  // состояние `entered` и повторно играла анимация «ухода в стопку»).
  // В Svelte это делает ключ `{#each ... (i)}` — отклонение №3 в журнале.
  import { resolveEntry, tailStyle, visibleChain, visibleTails } from '../core'
  import type { Chain, MobileAnchor, ResolvedEntry, TailDirection } from '../types'
  import { useModals } from './context'

  interface Props {
    activeEntry: ResolvedEntry
    anchor: MobileAnchor | undefined
    direction: TailDirection
    /**
     * Чем считать стопку. По умолчанию — видимая цепочка.
     *
     * Лист передаёт ПОЛНУЮ: его собственная запись headless своего DOM не
     * имеет, но в потоке он настоящая поверхность, и модалка под ним
     * обязана уйти в стопку с хвостом.
     */
    chain?: Chain
  }
  let { activeEntry, anchor, direction, chain: chainProp }: Props = $props()

  const m = useModals()
  const config = $derived(m.view.hostConfig)
  // Хвосты считаются по видимой цепочке: headless-запись своего хвоста
  // иметь не может, она ничего не рисует (ISSUES.md R-02).
  const chain = $derived(chainProp ?? visibleChain(m.view.chain))

  const indices = $derived(
    direction === 'none' || config.stackAnimation === 'none'
      ? []
      : visibleTails(chain.length, config.tailCount),
  )

  // «Появился» — отдельно на каждый хвост: до первого кадра он совпадает
  // с активной оболочкой, и только потом уезжает в стопку.
  //
  // Массив, а не Set: `$state(new Set())` не реактивен на `add()` —
  // руны следят за свойствами объекта, а не за методами коллекций.
  // Ловилось тем, что ближайший хвост оставался без transform.
  let entered = $state<number[]>([])
  $effect(() => {
    const pending = indices.filter((i) => !entered.includes(i))
    if (pending.length === 0) return
    const id = requestAnimationFrame(() => {
      entered = [...entered, ...pending]
    })
    return () => cancelAnimationFrame(id)
  })

  const style = (css: Record<string, string | number>) =>
    Object.entries(css)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')
</script>

{#each indices as i, depth (i)}
  {@const tailEntry = resolveEntry(chain[i], i, m.scope.lookup)}
  <div
    aria-hidden="true"
    class="modal-tail"
    data-depth={depth + 1}
    style={style(
      tailStyle({
        activeEntry,
        tailEntry,
        depthFromTop: depth + 1,
        direction,
        tailScale: config.tailScale,
        anchor,
        stackAnimation: config.stackAnimation,
        entered: entered.includes(i),
      }),
    )}
  ></div>
{/each}
