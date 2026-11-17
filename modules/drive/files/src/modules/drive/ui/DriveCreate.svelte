<script lang="ts">
  /** Создание папки и загрузка файла в текущую папку (4d–4e). */
  import { untrack } from 'svelte'
  import Field from '#core/ui/form/Field.svelte'
  import { Button } from '#core/ui/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import { bind, Form } from '#core/lib/form/svelte/index.js'
  import { driveMkdirForm, driveUploadForm } from '../form.js'

  interface Props {
    parentId: string | null
    returnTo: string
  }

  let { parentId, returnTo }: Props = $props()

  const init = untrack(() => ({ parentId, returnTo }))
  const actionBase = init.returnTo.split('?')[0]
  const mkdir = bind(forms, driveMkdirForm(init.parentId, init.returnTo), {
    action: `${actionBase}?/mkdir`,
    instance: 'drive:mkdir',
    intercept: false,
  })
  const upload = bind(forms, driveUploadForm(init.parentId, init.returnTo), {
    action: `${actionBase}?/upload`,
    instance: 'drive:upload',
    intercept: false,
  })
</script>

<div class="mb-4 grid gap-3 sm:grid-cols-2" data-testid="drive-create">
  <Form form={mkdir} hiddenFields={mkdir.hidden()} class="flex items-end gap-2">
    <Field of={mkdir.f.name} />
    <Button type="submit" size="sm">Создать папку</Button>
  </Form>
  <Form form={upload} hiddenFields={upload.hidden()} class="flex items-end gap-2">
    <Field of={upload.f.file} />
    <Button type="submit" size="sm">Загрузить</Button>
  </Form>
</div>
