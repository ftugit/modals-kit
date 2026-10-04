<!-- Порт Skeleton из src/ui/modals/ui.tsx оригинала: разметка и классы 1:1. -->
<div class="modal-skeleton" aria-busy="true" aria-live="polite">
  <div class="modal-skeleton-line modal-skeleton-title"></div>
  <div class="modal-skeleton-line" style="width: 72%"></div>
  <div class="modal-skeleton-line" style="width: 58%"></div>
  <div class="modal-skeleton-grid">
    {#each Array(4) as _}
      <div class="modal-skeleton-card"></div>
    {/each}
  </div>
  <div class="modal-skeleton-line" style="width: 40%"></div>
</div>
