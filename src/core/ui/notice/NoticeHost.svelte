<script lang="ts">
  import { dismissNotice, noticeQueue } from './notice.svelte.js'
  import { cn } from '#core/ui/utils.js'

  const notices = $derived(noticeQueue.items)
</script>

<div
  class="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4"
  aria-live="polite"
  aria-atomic="true"
  data-testid="notice-host"
>
  {#each notices as notice (notice.id)}
    <div
      class={cn(
        'pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg',
        notice.tone === 'error' ? 'border-destructive bg-destructive/10' : 'border-border bg-background',
      )}
      role="status"
      data-testid="notice"
    >
      <span class="min-w-0 flex-1">{notice.text}</span>
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground"
        aria-label="Закрыть уведомление"
        onclick={() => dismissNotice(notice.id)}
      >
        ×
      </button>
    </div>
  {/each}
</div>
