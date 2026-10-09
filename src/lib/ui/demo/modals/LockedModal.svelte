<script lang="ts">
  // Порт LockedModal из src/features/modals/demo-modals.tsx оригинала.
  import { ForceClose } from '$lib/ui/modals'
</script>

<div class="flex min-h-0 flex-auto flex-col items-center justify-center gap-3 p-6 text-center">
  <div class="text-base font-semibold tracking-tight">Заблокированная модалка</div>
  <p class="max-w-sm text-sm text-muted-foreground">
    Esc, клик по фону, «закрыть всё» и «Назад» её не закрывают — адрес возвращается обратно.
    Работает только принудительное закрытие.
  </p>
  <ForceClose>Закрыть принудительно</ForceClose>
</div>
