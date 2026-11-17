<script lang="ts">
  /**
   * Шаг «Профиль» во входе (`AuthWidget`): расширение модуля `user/profile`.
   * Базовый слой не знает ни `ProfileForm`, ни лимитов профиля — он лишь
   * передаёт сюда общие пропсы носителя.
   */
  import ProfileForm from './profile-form/ProfileForm.svelte'
  import type { AuthStepProps } from '#modules/user/base/svelte/auth-extensions.js'
  import type { ProfileLimits } from './profile-form/index.js'

  let {
    limits,
    authorized,
    enabled,
    doneHref = '/',
    onDone,
    variant = 'plain',
    class: className,
  }: AuthStepProps = $props()
</script>

<ProfileForm
  limits={limits as ProfileLimits | undefined}
  {authorized}
  {enabled}
  {doneHref}
  {onDone}
  variant={variant as never}
  class={className}
/>
