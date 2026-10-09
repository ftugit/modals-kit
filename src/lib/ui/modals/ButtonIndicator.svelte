<script lang="ts">
  // Порт ButtonIndicator из src/ui/modals/ui.tsx оригинала.
  // Индикатор на кнопке: до гидрации (скелетон), загрузка, ошибка.
  // Скелетона до гидратации нет: кнопка и без JS — рабочая ссылка, а мигающая
  // заглушка только дёргала вёрстку на каждом холодном рендере.
  import { MODAL_SPINNER_CLASS } from '$lib/modals/svelte/classes'
  import WarningIcon from './WarningIcon.svelte'

  let { state }: { state: 'idle' | 'loading' | 'open' | 'error' } = $props()
</script>

{#if state === 'loading'}
  <span class={MODAL_SPINNER_CLASS} data-modal-spinner="" aria-hidden="true"></span>
{/if}
{#if state === 'error'}
  <WarningIcon size={16} />
{/if}
