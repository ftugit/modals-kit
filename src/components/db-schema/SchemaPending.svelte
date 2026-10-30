<script lang="ts">
  /**
   * Экран переноса схемы: показывается на `/schema`, пока модели разошлись со
   * схемой так, что само не применить.
   *
   * Отправка — штатная для `lib/form`: нативный POST на `?/schema` (без JS тоже
   * работает). Ответ маршрута: успех — `303` на исходную страницу (`?next=`),
   * отказ — `fail` с `Result`, который сюда приходит `continuation`.
   *
   * Компонент живёт в `#components/*`, а не в демо-маршруте: экран нужен любой
   * странице с БД, а не только `/db-demo`. Описание формы и слова — из
   * `#hooks/db-schema.js` (там библиотеки соединяются), разметка — здесь.
   */
  import { untrack } from 'svelte'
  import { bind, Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { Badge, Button } from '#components/ui/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { kitActionTransport } from '#hooks/component-form/transport.js'
  import { schemaForm, type SchemaScreen } from '#hooks/db-schema.js'

  let { screen, seed = null }: { screen: SchemaScreen; seed?: Result | null } = $props()

  // Экран — снимок отчёта на момент загрузки: новое решение = новая загрузка страницы.
  const snapshot = untrack(() => screen)
  // Транспорт — тот же адрес, что у нативного `action`: именованный экшен
  // маршрута (`?/schema`). У проекта транспорта по умолчанию нет намеренно:
  // адрес отправки принадлежит форме, а не конфигу.
  const form = bind(forms, schemaForm(snapshot), {
    action: '?/schema',
    transport: kitActionTransport('?/schema'),
    continuation: untrack(() => seed),
  })
  const manual = snapshot.steps.filter((s) => !s.field)
</script>

<section class="flex flex-col gap-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm" data-testid="schema-pending">
  <div class="flex flex-col gap-1.5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold leading-tight tracking-tight">Схема базы отстала от моделей</h2>
      <Badge variant="destructive">Требуется миграция</Badge>
    </div>
    <p class="text-sm text-muted-foreground">
      Часть изменений нельзя применить сама: они могут потерять данные. Пока решения нет, страницы с базой не работают.
    </p>
  </div>

  {#if manual.length}
    <ul class="flex flex-col gap-2 text-sm">
      {#each manual as step (step.key)}
        <li class="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span class="font-medium">{step.title}</span>
          <span class="text-muted-foreground">({step.where}).</span>
          {#if step.hint} {step.hint}.{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if !snapshot.enabled}
    <p class="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="schema-disabled">
      Кнопка «Выполнить» выключена: на сервере не задан DB_ADMIN_TOKEN (не короче 32 символов). Задайте его в
      переменных окружения и перезапустите приложение — или поправьте модель.
    </p>
    <ul class="flex flex-col gap-1.5 text-sm">
      {#each snapshot.steps.filter((s) => s.field) as step (step.key)}
        <li><span class="font-medium">{step.title}</span> <span class="text-muted-foreground">({step.where})</span></li>
      {/each}
    </ul>
  {:else if snapshot.steps.some((s) => s.field)}
    <Form form={form} hiddenFields={form.hidden()} class="flex flex-col gap-4">
      <Common errors={form.common} title="Перенос не выполнен" />
      {#each snapshot.steps as step (step.key)}
        {#if step.field}<Field of={form.f[step.field]!} />{/if}
      {/each}
      <Field of={form.f.token!} />
      <div>
        <Button type="submit" data-testid="schema-run" task={formTask(form.state)}>Выполнить</Button>
      </div>
    </Form>
  {/if}
</section>
