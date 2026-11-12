<!--
  Массовый выход: один компонент на список сессий и на экран выхода.

  Намерение — набор идентификаторов, а не режим: `only` закрывает ровно
  перечисленные строки, `except` — все строки цели, кроме перечисленных. Чекбокс
  «включая текущую» меняет набор, а не экран: снят — текущая выходит из него
  (в `only` удаляется из списка, в `except` попадает в исключения).

  Удержание — только когда в наборе больше одной строки: одну запись
  подтверждать удержанием незачем (то же правило у массовых действий блокировок).

  Шаг живёт в адресе: без JS «Далее» — обычная ссылка, а состояние чекбокса
  не теряется, потому что чекбокс и отправка стоят на одном экране.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import HoldButton from '#components/ui/button/HoldButton.svelte'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { userSession } from '../../vault.svelte.js'
  import { sessionBulkExitForm } from '../../sessions.form.js'

  interface Props {
    /** Идентификаторы строк среза. */
    ids?: readonly string[]
    /** `only` — закрыть перечисленные, `except` — все, кроме перечисленных. */
    pick?: 'only' | 'except'
    /** Своя текущая сессия: её и убирает снятый чекбокс. */
    currentId?: string | null
    /** Сколько всего строк в срезе — размер набора в режиме `except`. */
    total?: number
    /** Чекбокс «включая текущую» отмечен: инверсия того же набора. */
    includeCurrent?: boolean
    /**
     * Чекбокс расширяет набор до всего аккаунта (экран выхода), а не впускает
     * в него текущую сессию (список). Набор в обоих случаях считает сервер.
     */
    spread?: boolean
    /** Шаг из адреса, не из состояния компонента. */
    step?: 'summary' | 'confirm'
    confirmHref?: string
    backHref?: string
    /** Куда уходит POST. */
    action?: string
    holdSeconds?: number
    heading?: string
    confirmLabel?: string
    /** Подпись чекбокса. По умолчанию — по роли: набор или весь аккаунт. */
    checkboxLabel?: string
    summary?: string
    testId?: string
    /** Успешная отправка: носитель решает, что делать с сессией в RAM. */
    onDone?: () => void
    form?: { result?: import('#lib/form/index.js').Result } | null
    class?: string
  }

  let {
    ids = [],
    pick = 'only',
    currentId = null,
    total = 0,
    includeCurrent = false,
    spread = false,
    step = 'summary',
    confirmHref,
    backHref,
    action,
    holdSeconds = 2,
    heading = 'Завершение сессий',
    confirmLabel = 'Завершить сессии',
    checkboxLabel,
    summary = '',
    testId = 'bulk-exit',
    onDone,
    form = null,
    class: className,
  }: Props = $props()

  const checkboxText = $derived(checkboxLabel ?? (spread ? 'Выйти на всех устройствах' : undefined))
  const shape = $derived({ pick, ids, includeCurrent, spread, checkboxLabel: checkboxText })
  const bound = bindComponentForm(forms, untrack(() => sessionBulkExitForm(shape)), {
    action: untrack(() => action) ?? './?/others',
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  const checked = $derived(
    bound.state.values.include_current === true ||
      String(bound.state.values.include_current ?? '') === 'on',
  )
  /** Сколько строк закроет набор при текущем состоянии чекбокса. */
  const size = $derived.by(() => {
    // Экран выхода: снятый чекбокс — одна текущая сессия, отмеченный — весь
    // аккаунт. Число строк среза знает носитель, `ids` тут роли не играют.
    if (spread) return checked ? Math.max(1, total ?? ids.length) : 1
    const base = new Set(ids)
    if (currentId) {
      if (checked) {
        if (pick === 'except') base.delete(currentId)
      } else if (pick === 'only') base.delete(currentId)
      else base.add(currentId)
    }
    return pick === 'only' ? base.size : Math.max(0, total - base.size)
  })
  const withHold = $derived(size > 1)

  // Успех формы: куки снял гейтвей, но сессия в памяти ещё жива — решать
  // носителю (модалка закрывается, страница чистит хранилище).
  let lastHandled: string | undefined
  $effect(() => {
    const result = bound.state.result
    if (!result?.ok || result.submissionId === lastHandled) return
    lastHandled = result.submissionId
    untrack(() => onDone?.())
  })
</script>

{#if step === 'confirm'}
  <Form
    id="user-sessions-bulk-exit"
    form={bound}
    hiddenFields={bound.hidden()}
    class={cn('flex w-full flex-col gap-4 text-left', className)}
    data-testid={testId}
  >
    <div hidden>
      <Field of={bound.f.pick} />
      <Field of={bound.f.ids} />
      <Field of={bound.f.spread} />
    </div>

    <Common errors={bound.common} title="Не получилось завершить сессии" />

    <div class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold leading-tight tracking-tight">{heading}</h2>
      {#if summary}
        <p class="text-sm text-muted-foreground">{summary}</p>
      {/if}

      {#if currentId}
        <Field of={bound.f.include_current} />
        <p class="text-xs text-muted-foreground">
          {#if spread}
            {#if checked}
              Все устройства аккаунта выйдут из него, включая это.
            {:else}
              Выйдет только это устройство: остальные сессии останутся живы.
            {/if}
          {:else if checked}
            Текущая сессия тоже завершится — вход на этом устройстве закроется.
          {:else}
            Текущая сессия останется жива: выйти из неё можно будет позже.
          {/if}
        </p>
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        {#if withHold}
          <HoldButton
            type="submit"
            name="intent"
            value="bulk-exit"
            variant="destructive"
            seconds={holdSeconds}
            when="fill"
            hover
            task={formTask(bound.state, 'bulk-exit')}
            data-testid={`${testId}-hold`}
            data-mass-hold="true"
          >
            {confirmLabel}
          </HoldButton>
        {:else}
          <Button
            type="submit"
            name="intent"
            value="bulk-exit"
            variant="destructive"
            task={formTask(bound.state, 'bulk-exit')}
            data-testid={`${testId}-submit`}
          >
            {confirmLabel}
          </Button>
        {/if}
        {#if backHref}
          <Button href={backHref} variant="outline" data-testid={`${testId}-back`}>Назад</Button>
        {/if}
      </div>
    </div>
  </Form>
{:else}
  <div class={cn('flex w-full flex-col gap-3 text-left', className)} data-testid={testId}>
    <h2 class="text-lg font-semibold leading-tight tracking-tight">{heading}</h2>
    {#if summary}
      <p class="text-sm text-muted-foreground">{summary}</p>
    {/if}
    <p class="text-sm" data-testid={`${testId}-count`}>
      Будет завершено сессий: <strong>{size}</strong>
    </p>
    {#if confirmHref}
      <Button href={confirmHref} variant="outline" class="self-start" data-testid={`${testId}-next`}>
        Далее
      </Button>
    {/if}
  </div>
{/if}
