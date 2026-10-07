<!-- Порт Skeleton из src/ui/modals/ui.tsx оригинала: та же разметка,
     оформление — атомарные утилиты из $lib/modals/svelte/classes, а снаружи
     скелетон виден по data-modal-skeleton(-line/grid/card). -->
<script lang="ts">
  import {
    MODAL_SKELETON_CARD_CLASS,
    MODAL_SKELETON_CLASS,
    MODAL_SKELETON_GRID_CLASS,
    MODAL_SKELETON_LINE_CLASS,
    MODAL_SKELETON_TITLE_CLASS,
  } from '$lib/modals/svelte/classes'
</script>

<div class={MODAL_SKELETON_CLASS} data-modal-skeleton="" aria-busy="true" aria-live="polite">
  <div
    class={`${MODAL_SKELETON_LINE_CLASS} ${MODAL_SKELETON_TITLE_CLASS}`}
    data-modal-skeleton-line=""
    data-modal-skeleton-title=""
  ></div>
  <div class={MODAL_SKELETON_LINE_CLASS} data-modal-skeleton-line="" style="width: 72%"></div>
  <div class={MODAL_SKELETON_LINE_CLASS} data-modal-skeleton-line="" style="width: 58%"></div>
  <div class={MODAL_SKELETON_GRID_CLASS} data-modal-skeleton-grid="">
    {#each Array(4) as _}
      <div class={MODAL_SKELETON_CARD_CLASS} data-modal-skeleton-card=""></div>
    {/each}
  </div>
  <div class={MODAL_SKELETON_LINE_CLASS} data-modal-skeleton-line="" style="width: 40%"></div>
</div>
