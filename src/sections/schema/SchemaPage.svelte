<script lang="ts">
  /** Страница переноса схемы — section-компонент (тонкий носитель в route). */
  import { untrack } from 'svelte'
  import type { loadSchema } from './load.server.js'
  import SchemaPending from '#core/ui/db-schema/SchemaPending.svelte'
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import type { Result } from '#core/lib/form/index.js'
  import { bind, Form } from '#core/lib/form/svelte/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import { Button } from '#core/ui/index.js'
  import Common from '#core/ui/form/Common.svelte'
  import Field from '#core/ui/form/Field.svelte'
  import { schemaUnlockForm } from '#core/hooks/db-schema.js'
  import type { SchemaActionData } from './types.js'

  let { data, form }: { data: Awaited<ReturnType<typeof loadSchema>>; form: SchemaActionData | null } = $props()

  const seed = $derived((form as { result?: Result } | null)?.result ?? null)
  const unlock = bind(forms, schemaUnlockForm(), {
    action: '?/unlock',
    continuation: untrack(() => form?.result),
  })

  useHeadSeo({
    subTitle: 'Перенос схемы базы',
    description: 'Подтверждение и применение миграций схемы базы данных.',
    noindex: true,
  })
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
  <h1 class="text-2xl font-semibold tracking-tight">Перенос схемы базы</h1>

  {#if data.locked === 'disabled'}
    <p class="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" data-testid="schema-disabled">
      Перенос схемы выключен: на сервере не задан DB_ADMIN_TOKEN (не короче 32 символов).
    </p>
  {:else if data.locked === 'token'}
    <section class="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm" data-testid="schema-locked">
      <div class="flex flex-col gap-1.5">
        <h2 class="text-lg font-semibold leading-tight tracking-tight">Доступ к переносу схемы</h2>
        <p class="text-sm text-muted-foreground">
          Отчёт и решения доступны только с секретом DB_ADMIN_TOKEN — он проверяется до показа схемы.
        </p>
      </div>
      <Form form={unlock} hiddenFields={unlock.hidden()} class="flex flex-col gap-4">
        <Common errors={unlock.common} title="Доступ не открыт" />
        <Field of={unlock.f.token!} />
        <div>
          <Button type="submit" data-testid="schema-unlock">Открыть отчёт</Button>
        </div>
      </Form>
    </section>
  {:else if data.screen}
    <SchemaPending screen={data.screen} token={data.token} {seed} />
  {:else}
    <p class="rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-sm" role="status" data-testid="schema-ok">
      <span class="mr-1.5 font-semibold text-success" aria-hidden="true">✓</span>Схема в порядке — решать нечего.
    </p>
  {/if}

  {#if data.next}
    <a href={data.next} class="text-sm text-primary underline">Вернуться на страницу</a>
  {:else}
    <a href="/" class="text-sm text-primary underline">На главную</a>
  {/if}
</div>
