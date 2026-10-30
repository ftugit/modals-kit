<script lang="ts">
  // Порт ModalError из src/ui/modals/ui.tsx оригинала.
  // Ошибка: нет такой модалки или упал загрузчик.
  import {
    MODAL_ERROR_CLASS,
    MODAL_ERROR_HINT_CLASS,
    MODAL_ERROR_TITLE_CLASS,
  } from '#lib/modals/svelte/classes.js'
  import WarningIcon from '#components/ui/warning-icon/WarningIcon.svelte'

  let { message, hint }: { message: string; hint?: string } = $props()
</script>

<div class={MODAL_ERROR_CLASS} data-modal-error="" role="alert">
  <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
    <WarningIcon size={20} />
  </span>
  <div class={MODAL_ERROR_TITLE_CLASS} data-modal-error-title="">{message}</div>
  {#if hint}<div class={MODAL_ERROR_HINT_CLASS} data-modal-error-hint="">{hint}</div>{/if}
</div>
