<script lang="ts">
  import Button from '#lib/ui/primitives/Button.svelte'
  // Экран остановки приложения (Q1). НИ строки из ошибки: причина живёт в консоли
  // разработчика (warn) и в логе сервера, пользователю — только факт сбоя.
</script>

<!-- Корень — <div>: ориентир main даёт место вызова (layout при фатале — свой
     <main>, +error — <main> каркаса). Свой <main> здесь дублировал бы ориентир. -->
<div class="grid min-h-dvh place-items-center bg-background px-6 text-foreground" data-testid="error-500">
  <!-- role="alert" — на содержимом: анонс при динамической вставке (B4) -->
  <div class="flex max-w-md flex-col items-center gap-4 text-center" role="alert">
    <span class="text-6xl font-black tracking-tight text-muted-foreground">500</span>
    <h1 class="text-xl font-semibold">Приложение недоступно</h1>
    <p class="text-sm text-muted-foreground">
      Произошла внутренняя ошибка и приложение было остановлено, чтобы не показывать
      некорректные данные. Попробуйте обновить страницу.
    </p>
    <Button onclick={() => location.reload()} data-testid="error-500-reload">Обновить страницу</Button>
  </div>
</div>
