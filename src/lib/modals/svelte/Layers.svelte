<script lang="ts">
  // Слои стопки: активный виден, нижние остаются смонтированными
  // (сохраняют состояние и прокрутку), но скрыты без `display:none`.
  import { resolveEntry, visibleChain } from '../core'
  import { entryLabel } from '../types'
  import { useModals } from './context'
  import ModalContent from './ModalContent.svelte'

  // Контекст держим целиком: хост переживает смену ядра, геттеры живые.
  const m = useModals()

  // Только видимые записи: headless своего DOM не имеет и слоем быть
  // не может — иначе он становится активным и прячет настоящую модалку.
  const chain = $derived(visibleChain(m.view.chain))

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
    class="modal-layer"
    data-active={active || undefined}
    aria-hidden={active ? undefined : 'true'}
    inert={!active}
    style={active ? undefined : HIDDEN}
  >
    <ModalContent entry={resolveEntry(entry, i, m.scope.lookup)} {active} />
  </div>
{/each}
