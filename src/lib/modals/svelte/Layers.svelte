<script lang="ts">
  // Слои стопки: активный виден, нижние остаются смонтированными
  // (сохраняют состояние и прокрутку), но скрыты без `display:none`.
  import { resolveEntry, visibleChain } from '../core'
  import { entryLabel } from '../types'
  import type { ChainEntry } from '../types'
  import { useModals } from './context'
  import { MODAL_LAYER_CLASS } from './classes'
  import ModalContent from './ModalContent.svelte'

  interface Props {
    /**
     * Готовая цепочка слоёв вместо живой из стора. Хост передаёт снапшот
     * последней цепочки на время exit-фазы: цепочка в сторе уже пуста, а
     * поддерево слоёв обязано дожить до конца анимации БЕЗ перемонтирования
     * (иначе содержимое на закрытии мигает — свежий монтаж внутри уезжающей
     * оболочки; поймано мобильной пробой).
     */
    entries?: ChainEntry[]
  }
  let { entries }: Props = $props()

  // Контекст держим целиком: хост переживает смену ядра, геттеры живые.
  const m = useModals()

  // Только видимые записи: headless своего DOM не имеет и слоем быть
  // не может — иначе он становится активным и прячет настоящую модалку.
  const chain = $derived(entries ?? visibleChain(m.view.chain, m.claimEntry))

  const HIDDEN =
    'position:absolute;inset:0;visibility:hidden;pointer-events:none;overflow:hidden'
</script>

{#each chain as entry, i (entryLabel(entry) + ':' + i)}
  {@const active = i === chain.length - 1}
  <!--
    `inert` — обычный атрибут: Svelte ставит именно атрибут, поэтому ручной
    setAttribute из оригинала не нужен (отклонение №4 в журнале).
    Нужен, чтобы Tab не попадал в скрытые нижние слои.
  -->
  <div
    class={MODAL_LAYER_CLASS}
    data-modal-layer=""
    data-active={active || undefined}
    aria-hidden={active ? undefined : 'true'}
    inert={!active}
    style={active ? undefined : HIDDEN}
  >
    <ModalContent entry={resolveEntry(entry, i, m.scope.lookup)} {active} />
  </div>
{/each}
