<script lang="ts">
  /**
   * Компонент удаления профиля цели: предупреждение, при праве на seed —
   * чекбокс «также удалить seed-аккаунт», подтверждение удержанием кнопки
   * (как создание аккаунта). Видимость кнопки снаружи решает флаг чтения
   * профиля; права и запреты цели при отправке перепроверяет сервер.
   */
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
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { profileDeleteForm } from './form.js'

  interface Props {
    /** id аккаунта-цели. */
    uid: string
    /** Право на seed цели: чекбокс «также удалить seed-аккаунт». */
    canDeleteSeed?: boolean
    /** Куда вести после удаления (кнопка готового состояния). */
    doneHref?: string
    /** Секунд удержания кнопки подтверждения (конфиг модуля). */
    holdSeconds?: number
    action?: string
    form?: { result?: import('#lib/form/index.js').Result } | null
    onDone?: () => void
    class?: string
  }

  let {
    uid,
    canDeleteSeed = false,
    doneHref,
    holdSeconds = 2,
    action,
    form,
    onDone,
    class: className,
  }: Props = $props()

  const bound = bindComponentForm(forms, profileDeleteForm, {
    action: untrack(() => action) ?? './?/profileDelete',
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })
  mirrorToField(bound, 'subject', () => uid)

  const done = $derived(
    (bound.state.result?.data as { step?: string } | undefined)?.step === 'done',
  )
  $effect(() => {
    if (done) onDone?.()
  })
</script>

{#if done}
  <div class={cn('mx-auto flex w-full max-w-sm flex-col gap-3 text-left', className)}>
    <h2 class="text-base font-semibold">Профиль удалён</h2>
    <p class="text-sm text-muted-foreground">
      Профиль больше не показывается. Если был отмечен и seed-аккаунт, он помечен на удаление
      и будет стёрт окончательно по истечении срока.
    </p>
    {#if doneHref}
      <Button href={doneHref} variant="outline" class="self-start">К профилю</Button>
    {/if}
  </div>
{:else}
  <Form
    id="user-profile-delete"
    form={bound}
    hiddenFields={bound.hidden()}
    class={cn('mx-auto flex w-full max-w-sm flex-col gap-4 text-left', className)}
  >
    <Common errors={bound.common} title="Не получилось удалить" />

    <div hidden aria-hidden="true"><Field of={bound.f.subject} /></div>

    <div class="flex flex-col gap-3">
      <h2 class="text-base font-semibold">Удаление профиля</h2>
      <p class="text-sm text-muted-foreground">
        Профиль удалится сразу и перестанет показываться. Seed-аккаунт при этом останется:
        владелец сможет снова заполнить профиль.
      </p>

      {#if canDeleteSeed}
        <Field of={bound.f.with_seed} />
        <p class="text-xs text-muted-foreground">
          С seed-аккаунтом вход закроется сразу, а окончательно всё сотрётся по истечении
          срока удаления.
        </p>
      {/if}

      <HoldButton
        type="submit"
        name="intent"
        value="delete"
        variant="destructive"
        seconds={holdSeconds}
        when="fill"
        hover
        task={formTask(bound.state, 'delete')}
        class="self-start"
      >
        Удерживайте, чтобы удалить
      </HoldButton>
    </div>
  </Form>
{/if}
