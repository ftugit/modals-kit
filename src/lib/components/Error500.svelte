<script lang="ts">
  // Экран остановки приложения (Q1). НИ строки из ошибки: причина живёт в консоли
  // разработчика (warn) и в логе сервера, пользователю — только факт сбоя.
</script>

<main class="grid min-h-dvh place-items-center bg-background px-6 text-foreground" role="alert" data-testid="error-500">
  <div class="flex max-w-md flex-col items-center gap-4 text-center">
    <span class="text-6xl font-black tracking-tight text-muted-foreground">500</span>
    <h1 class="text-xl font-semibold">Приложение недоступно</h1>
    <p class="text-sm text-muted-foreground">
      Произошла внутренняя ошибка и приложение было остановлено, чтобы не показывать
      некорректные данные. Попробуйте обновить страницу.
    </p>
    <button
      class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      onclick={() => location.reload()}
      data-testid="error-500-reload"
    >
      Обновить страницу
    </button>
  </div>
</main>
