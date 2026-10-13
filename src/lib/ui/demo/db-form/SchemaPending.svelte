<script lang="ts">
  /**
   * Экран переноса схемы: показывается вместо страницы с базой, пока модели
   * разошлись со схемой так, что само не применить. Отправка — нативный POST
   * (`?/schema`, без перехвата): после переноса страница всё равно грузится заново,
   * а секрет не должен задерживаться в состоянии клиента.
   */
  import { untrack } from 'svelte'
  import { bind, Form } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { Button } from '#lib/ui/primitives/index.js'
  import { forms } from '#lib/ui/demo/form/forms.config.js'
  import Common from '#lib/ui/demo/form/ui/Common.svelte'
  import Field from '#lib/ui/demo/form/ui/Field.svelte'
  import { schemaForm, type SchemaScreen } from './schema'

  let { screen, seed = null }: { screen: SchemaScreen; seed?: Result | null } = $props()

  // Экран — снимок отчёта на момент загрузки: новое решение = новая загрузка страницы.
  const snapshot = untrack(() => screen)
  const form = bind(forms, schemaForm(snapshot), {
    action: '?/schema',
    intercept: false,
    continuation: untrack(() => seed),
  })
  const manual = snapshot.steps.filter((s) => !s.field)
</script>

<section class="space-y-4 rounded-xl border border-destructive/40 bg-card p-4" data-testid="schema-pending">
  <h2 class="text-lg font-semibold">Схема базы отстала от моделей</h2>
  <p class="text-sm text-muted-foreground">
    Часть изменений нельзя применить автоматически: они могут потерять данные. Пока решения нет, страницы с
    базой не работают.
  </p>

  {#if manual.length}
    <ul class="space-y-2 text-sm">
      {#each manual as step (step.title + step.where)}
        <li>
          <span class="font-medium">{step.title}</span>
          <span class="text-muted-foreground">({step.where}).</span>
          {#if step.hint}{step.hint}.{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if !snapshot.enabled}
    <p class="text-sm" data-testid="schema-disabled">
      Кнопка «Выполнить» выключена: на сервере не задан DB_ADMIN_TOKEN (не короче 32 символов). Задайте его в
      переменных окружения и перезапустите приложение — или поправьте модель.
    </p>
    <ul class="space-y-1 text-sm">
      {#each snapshot.steps.filter((s) => s.field) as step (step.field)}
        <li><span class="font-medium">{step.title}</span> <span class="text-muted-foreground">({step.where})</span></li>
      {/each}
    </ul>
  {:else if snapshot.steps.some((s) => s.field)}
    <Form form={form} hiddenFields={form.hidden()} class="space-y-3">
      <Common errors={form.common} title="Перенос не выполнен" />
      {#each snapshot.steps as step (step.field ?? step.title)}
        {#if step.field}<Field of={form.f[step.field]!} />{/if}
      {/each}
      <Field of={form.f.token!} />
      <Button type="submit" data-testid="schema-run">Выполнить</Button>
    </Form>
  {/if}
</section>
