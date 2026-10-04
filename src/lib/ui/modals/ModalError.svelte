<script lang="ts">
  // Порт ModalError из src/ui/modals/ui.tsx оригинала.
  // Ошибка: нет такой модалки или упал загрузчик.
  import WarningIcon from './WarningIcon.svelte'

  let { message, hint }: { message: string; hint?: string } = $props()
</script>

<div class="modal-error" role="alert">
  <WarningIcon size={24} />
  <div class="modal-error-title">{message}</div>
  {#if hint}<div class="modal-error-hint">{hint}</div>{/if}
</div>
