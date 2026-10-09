<script lang="ts">
  import { useShell } from '$lib/shell'
  const shell = useShell()
</script>

<div class="flex flex-col gap-1 text-[11px] text-muted-foreground px-1 py-1">
  <div class="flex items-center justify-between">
    <span>Dock:</span>
    <button
      type="button"
      class="min-h-6 min-w-6 px-1 text-right underline hover:text-foreground cursor-pointer text-[11px]"
      onclick={() => shell.setDock(shell.dock === 'top' ? 'bottom' : 'top')}
    >
      {shell.dock}
    </button>
  </div>
  <div class="flex items-center justify-between">
    <span>Side:</span>
    <button
      type="button"
      class="min-h-6 min-w-6 px-1 text-right underline hover:text-foreground cursor-pointer text-[11px]"
      onclick={() => shell.setSide(shell.side === 'left' ? 'right' : 'left')}
    >
      {shell.side}
    </button>
  </div>
</div>
