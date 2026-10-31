<script lang="ts">
  /**
   * Конструктор полей — три шага («Сборка», «Заполнение», «Результат») поверх
   * переиспользуемого модуля `#components/fields` и `#hooks/component-form`.
   */
  import { untrack } from 'svelte'
  import { goto } from '$app/navigation'
  import { DemoPanel } from '#components/demo/index.js'
  import { fieldsSurfaceVariants, SchemaBuilder, SchemaFields, SchemaValues } from '#components/fields/index.js'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { useHeadSeo } from '#components/shell/index.js'
  import { Steps, useSteps } from '#components/steps/index.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { Form } from '#lib/form/svelte/index.js'
  import { demoPanelSchema } from './demo-schema.ts'
  import { collectionForm, recordForm, resetForm, type FieldsStep } from './forms.js'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  const STEPS: readonly { key: FieldsStep; label: string }[] = [
    { key: 'build', label: 'Сборка' },
    { key: 'fill', label: 'Заполнение' },
    { key: 'result', label: 'Результат' },
  ]

  const filled = (key: FieldsStep): boolean => (key === 'build' ? Boolean(data.set) : Boolean(data.record))
  const steps = useSteps({
    owner: 'fields',
    mode: 'url',
    steps: () => STEPS.map((s) => ({ ...s, filled: filled(s.key) })),
    current: () => data.step,
    lockKey: 'fieldsNavLocked',
  })

  const reset = bindComponentForm(forms, untrack(() => resetForm()), {
    lockStateKey: 'fieldsNavLocked',
    onSuccess: () => void goto(steps.href('build')),
  })

  useHeadSeo({
    subTitle: 'Конструктор полей',
    description:
      'Конструктор полей формы field.fields: сборка набора полей с правилами, заполнение записи и просмотр результата.',
  })
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
  <header class="flex flex-col gap-2">
    <h1 class="text-3xl font-semibold tracking-tight">Конструктор полей</h1>
    <p class="text-muted-foreground">
      Соберите набор полей и правил к ним, сохраните — заполните запись на наборе и посмотрите результат.
    </p>
  </header>

  <DemoPanel schema={demoPanelSchema} />

  <div class="flex items-baseline gap-4">
    <span><Steps host={steps} label="Шаги" /></span>
    {#if data.step !== 'build'}
      <span class="ms-auto">
        <Form form={reset} hiddenFields={reset.hidden()} class="inline-flex">
          <Button type="submit" variant="link" size="none" data-testid="reset" {...reset.intent('reset')}>
            Сбросить
          </Button>
        </Form>
      </span>
    {/if}
  </div>

  <Steps host={steps} label="" nav={false}>
    {#snippet build()}
      <section class="flex flex-col gap-3" aria-labelledby="fields-step-builder">
        <h2 id="fields-step-builder" class="text-xl font-semibold">Создание полей</h2>
        {#key `${data.set?.version ?? 0}:${data.limit}`}
          <SchemaBuilder
            description={collectionForm(data.set?.fields, data.limit)}
            lockStateKey="fieldsNavLocked"
            onSuccess={() => void goto(steps.href('fill'))}
          />
        {/key}
        {#if data.set}
          <p class="rounded-lg border border-border p-3 text-sm" data-testid="saved-set">
            Набор сохранён (версия {data.set.version}), полей: {data.set.fields.length}.
          </p>
        {/if}
      </section>
    {/snippet}

    {#snippet fill()}
      {#if data.set}
        <section class="flex flex-col gap-3" aria-labelledby="fields-step-record">
          <div>
            <h2 id="fields-step-record" class="text-xl font-semibold">Заполнение</h2>
            <p class="text-sm text-muted-foreground">Хранится одна запись: новая отправка заменяет прежнюю.</p>
          </div>
          {#key `${data.set.version}:${data.record?.n ?? 0}`}
            <SchemaFields
              description={recordForm(data.set, data.record)}
              lockStateKey="fieldsNavLocked"
              onSuccess={() => void goto(steps.href('result'))}
            >
              {#snippet extraFields(form)}
                <Field of={form.f.title} />
                {#if data.record?.image}
                  <figure class="flex flex-col gap-1">
                    <img src={data.record.image} alt={data.record.title} class="h-16 rounded-md border border-border" />
                    <figcaption class="text-xs text-muted-foreground">Текущее изображение</figcaption>
                  </figure>
                {/if}
                <Field of={form.f.image} />
              {/snippet}
            </SchemaFields>
          {/key}
        </section>
      {/if}
    {/snippet}

    {#snippet result()}
      {#if data.record}
        <section class="flex flex-col gap-3" aria-labelledby="fields-step-view" data-testid="record-view">
          <h2 id="fields-step-view" class="text-xl font-semibold">Просмотр</h2>
          <article class={fieldsSurfaceVariants({ surface: 'card' })}>
            <h3 class="text-lg font-medium" data-testid="record-title">{data.record.title}</h3>
            <img src={data.record.image} alt={data.record.title} class="max-h-64 max-w-full rounded-md border border-border" />
            <SchemaValues fields={data.set?.fields ?? []} values={data.record.values} />
          </article>
        </section>
      {/if}
    {/snippet}
  </Steps>
</div>
