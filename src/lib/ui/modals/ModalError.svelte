<script lang="ts">
  // Порт ModalError из src/ui/modals/ui.tsx оригинала.
  // Ошибка: нет такой модалки или упал загрузчик.
  import {
    MODAL_ERROR_CLASS,
    MODAL_ERROR_HINT_CLASS,
    MODAL_ERROR_TITLE_CLASS,
  } from '$lib/modals/svelte/classes'
  import WarningIcon from './WarningIcon.svelte'

  let { message, hint }: { message: string; hint?: string } = $props()
</script>

<div class={MODAL_ERROR_CLASS} data-modal-error="" role="alert">
  <WarningIcon size={24} />
  <div class={MODAL_ERROR_TITLE_CLASS} data-modal-error-title="">{message}</div>
  {#if hint}<div class={MODAL_ERROR_HINT_CLASS} data-modal-error-hint="">{hint}</div>{/if}
</div>
