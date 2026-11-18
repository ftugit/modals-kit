<script lang="ts">
  /**
   * Общая единица операции «Диска» (`plan-drive-repair.md` §5.1): одна форма и
   * одна клиентская логика на страницу и модалку.
   *
   * Успех стационарен: адрес не меняется, слой не закрывается сам, квитанция
   * остаётся на месте. Переход объявлен только в регистрации и случается лишь
   * без JS (PRG на проверенный `return_to`).
   */
  import { untrack } from 'svelte'
  import { Form } from '#core/lib/form/svelte/index.js'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { invalidatePaginator } from '#core/lib/paginate/index.js'
  import { tryUseModals } from '#core/lib/modals/svelte/index.js'
  import { asLink } from '#core/hooks/links/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import Field from '#core/ui/form/Field.svelte'
  import Common from '#core/ui/form/Common.svelte'
  import { Button } from '#core/ui/index.js'
  import type { DriveOperationData } from '../types.js'
  import { DRIVE_OPERATIONS, type DriveOperationName } from '../operations.js'
  import { driveOperationDescription } from '../form.js'
  import { DRIVE_NAME } from '../source.js'

  interface Props {
    op: DriveOperationName
    data: DriveOperationData
    /** Результат нативного POST (`page.data.formResult`) при загрузке без JS. */
    form?: { result?: Result } | null
    onDone?: () => void
  }

  let { op, data, form = null, onDone }: Props = $props()

  // `op` и `data` читаются один раз: оболочка операции фиксирует их на всю жизнь
  // компонента, а реактивное чтение на инициализации только шумит предупреждением.
  const spec = untrack(() => DRIVE_OPERATIONS[op])
  const description = untrack(() =>
    driveOperationDescription(op, {
      parentId: data.parentId,
      returnTo: data.returnTo,
      nodeId: data.node?.id ?? '',
      name: data.values.name,
      starred: data.values.starred,
      folders: data.folders,
      targetId: data.values.targetId,
      uid: data.values.uid,
      tokenId: data.values.tokenId,
    }),
  )
  const bound = bindComponentForm(forms, description, {
    action: untrack(() => data.action),
    continuation: untrack(() => form?.result ?? undefined),
  })

  const payload = $derived(
    bound.state.result?.data as
      | { step?: string; token?: string; name?: string; count?: number; deleted?: number }
      | undefined,
  )
  const done = $derived(Boolean(bound.state.result?.ok) && payload?.step === 'done')

  let handled = ''
  $effect(() => {
    const current = bound.state.result
    if (!current?.ok || current.submissionId === handled) return
    if ((current.data as { step?: string } | undefined)?.step !== 'done') return
    handled = current.submissionId
    void invalidatePaginator(DRIVE_NAME)
    const m = tryUseModals()
    if (m) {
      for (const name of ['drive.browse', 'drive.trash', 'drive.node', 'drive.picker']) {
        m.modals.invalidateLoader(name)
      }
    }
    onDone?.()
  })
</script>

{#snippet back()}
  <a {...asLink(data.returnTo)} class="text-sm underline">Вернуться к списку</a>
{/snippet}

{#if done}
  <div class="flex flex-col gap-3" data-testid={`drive-op-done-${op}`}>
    <h2 class="text-base font-semibold leading-tight">Готово</h2>
    {#if payload?.token}
      <p class="text-sm text-muted-foreground">
        Скопируйте пароль сейчас: сервер хранит только HMAC, повторно он не покажется.
      </p>
      <code
        class="block w-full select-all break-all rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs"
        data-testid="drive-dav-token"
      >
        {payload.token}
      </code>
    {:else if typeof payload?.name === 'string'}
      <p class="text-sm text-muted-foreground">{payload.name}</p>
    {:else if typeof payload?.count === 'number'}
      <p class="text-sm text-muted-foreground">Затронуто узлов: {payload.count}.</p>
    {:else}
      <p class="text-sm text-muted-foreground">{spec.title}: операция выполнена.</p>
    {/if}
    {@render back()}
  </div>
{:else}
  <Form
    id={spec.formId}
    form={bound}
    hiddenFields={bound.hidden()}
    class="flex w-full flex-col gap-3 text-left"
    data-testid={`drive-op-${op}`}
  >
    <div class="flex flex-col gap-1">
      <h2 class="text-base font-semibold leading-tight">{spec.title}</h2>
      <p class="text-sm text-muted-foreground">{spec.description}</p>
    </div>

    <Common errors={bound.common} title="Не получилось выполнить операцию" />

    {#each spec.fields as field (field.name)}
      {#if field.visible}
        <Field of={bound.f[field.name as keyof typeof bound.f]} />
      {/if}
    {/each}

    <div hidden aria-hidden="true">
      {#each spec.fields as field (field.name)}
        {#if !field.visible}
          <Field of={bound.f[field.name as keyof typeof bound.f]} />
        {/if}
      {/each}
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Button type="submit" variant={spec.destructive ? 'destructive' : 'default'} size="sm">
        {spec.submit}
      </Button>
      {@render back()}
    </div>
  </Form>
{/if}
