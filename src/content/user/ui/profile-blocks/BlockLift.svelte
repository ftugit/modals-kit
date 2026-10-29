<script lang="ts">
  /**
   * Кнопка снятия одной активной блокировки: своя мини-форма на запись
   * (адреса — скрытые поля), чтобы снятие работало и без JS. Права
   * перепроверяет домен и модель в момент отправки.
   */
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { specBlocks } from '../../spec-block.js'
  import { mirrorToField } from '../field-mirror.svelte.js'
  import { blocksForm } from './form.js'

  interface Props {
    subject: string
    blockId: string
  }

  let { subject, blockId }: Props = $props()

  const bound = bindComponentForm(forms, blocksForm, {})
  mirrorToField(bound, 'subject', () => subject)
  mirrorToField(bound, 'block_id', () => blockId)
</script>

<Form form={bound} class="inline">
  <Button type="submit" name="intent" value="lift" task={formTask(bound.state, 'lift')} variant="ghost" size="sm">
    {specBlocks.liftButton}
  </Button>
</Form>
