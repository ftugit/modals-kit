<script lang="ts">
  // Порт FullpageModal из src/features/modals/demo-modals.tsx оригинала.
  import { useModal, useModals } from '$lib/modals/svelte'
  import { ModalTrigger } from '$lib/modals/svelte'
  import { CloseAllButton } from '$lib/ui/modals'

  const me = useModal()
  const m = useModals()
</script>

<div class="flex min-h-0 flex-auto flex-col">
  <div class="flex items-center justify-between border-b border-border px-6 py-4">
    <div>
      <div class="text-lg font-semibold tracking-tight">Полноэкранная модалка</div>
      <div class="text-xs text-muted-foreground">
        size: fullpage · без радиуса · иконка закрытия на фоне скрыта
      </div>
    </div>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
      onclick={() => m.modals.close()}
    >
      Закрыть
    </button>
  </div>
  <div class="min-h-0 flex-auto overflow-y-auto px-6 py-5">
    <p class="max-w-prose text-sm text-muted-foreground">
      Занимает весь экран: радиус снят, собственная иконка закрытия на фоне не выводится. Внутри
      — свой скролл, стопка и хвосты работают как обычно, поэтому отсюда можно открыть вложенную
      карточку.
    </p>
    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each Array(9) as _, i (i)}
        <div class="rounded-lg border border-border bg-muted/50 p-4 text-xs text-muted-foreground">
          Блок содержимого №{i + 1} · глубина {me.depth}
        </div>
      {/each}
    </div>
    <div class="mt-5 flex flex-wrap gap-2">
      <ModalTrigger name="card" params={{ id: 501 }}>
        Открыть карточку поверх
      </ModalTrigger>
      <CloseAllButton />
    </div>
  </div>
</div>
