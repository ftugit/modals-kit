<script lang="ts">
  /**
   * Блок приватности в своём профиле: кто видит профиль (`all`/`users`/
   * `nobody`). Запись — конфиг-API через встраиваемую форму: значение
   * переопределяет глобальный ключ за владельцем, выбор умолчания строку
   * юзера не плодит (правило конфиг-модели). Показ блока — дело компонента
   * чтения: сюда он приходит только у владельца, на чужом профиле блока нет.
   */
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import Field from '#components/form/Field.svelte'
  import Common from '#components/form/Common.svelte'
  import { Button } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import { specProfile } from '../../spec-profile.js'
  import type { VisibilityLevel } from '../../types.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { privacyForm } from './form.js'

  interface Props {
    /** Текущий эффективный уровень владельца (из чтения профиля). */
    level: VisibilityLevel
    class?: string
  }

  let { level, class: className }: Props = $props()

  const bound = bindComponentForm(forms, privacyForm, {})
  if (!bound.state.result) {
    mirrorToField(bound, 'level', () => level)
  }
</script>

<section class={cn('flex w-full flex-col gap-3 text-left', className)} data-testid="profile-privacy">
  <h3 class="text-base font-semibold">{specProfile.privacyTitle}</h3>
  <Form id="user-profile-privacy" form={bound} class="flex flex-col gap-3">
    <Common errors={bound.common} title="Проверьте форму" />
    <Field of={bound.f.level} />
    <div>
      <Button type="submit" name="intent" value="privacy" task={formTask(bound.state, 'privacy')}>
        Сохранить
      </Button>
    </div>
  </Form>
</section>
