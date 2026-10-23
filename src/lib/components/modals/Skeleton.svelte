<!-- Композиция плейсхолдеров загрузки модального окна поверх единого
     примитива `ui/skeleton/Skeleton.svelte`; снаружи размечена `data-modal-skeleton*`. -->
<script lang="ts">
  import { Skeleton as UiSkeleton } from '#lib/components/ui/index.js'
  import { MODAL_SKELETON_CLASS } from '#lib/modals/svelte/classes.js'
</script>

<div class={MODAL_SKELETON_CLASS} data-modal-skeleton="" aria-busy="true" aria-live="polite">
  <UiSkeleton
    variant="line"
    class="h-5 w-[55%]"
    data-modal-skeleton-line=""
    data-modal-skeleton-title=""
  />
  <UiSkeleton variant="line" class="h-3" data-modal-skeleton-line="" style="width: 72%" />
  <UiSkeleton variant="line" class="h-3" data-modal-skeleton-line="" style="width: 58%" />
  <div class="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2.5 pt-1" data-modal-skeleton-grid="">
    {#each Array(4) as _}
      <UiSkeleton variant="card" class="h-16" data-modal-skeleton-card="" />
    {/each}
  </div>
  <UiSkeleton variant="line" class="h-3" data-modal-skeleton-line="" style="width: 40%" />
</div>
