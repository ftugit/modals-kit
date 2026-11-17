<script lang="ts">
  /**
   * Экран доступа узла (4f): выдать/сменить роль и отозвать.
   * Показывается только тому, у кого есть `canShare`; список доступов
   * приходит загрузчиком, а не считается компонентом.
   */
  import { untrack } from 'svelte'
  import Field from '#core/ui/form/Field.svelte'
  import { Badge, Button } from '#core/ui/index.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import { bind, Form } from '#core/lib/form/svelte/index.js'
  import { driveShareForm, driveUnshareForm } from '../form.js'
  import type { DriveShareView } from '../types.js'

  interface Props {
    nodeId: string
    shares: readonly DriveShareView[]
    returnTo: string
  }

  let { nodeId, shares, returnTo }: Props = $props()

  // Формы привязываются один раз: адрес и id узла не меняются без перезагрузки.
  const init = untrack(() => ({ nodeId, shares, returnTo }))
  const actionBase = init.returnTo.split('?')[0]
  const short = (value: string) => value.replace(/-/g, '').slice(0, 8)
  const share = bind(forms, driveShareForm(init.nodeId, init.returnTo), {
    action: `${actionBase}?/share`,
    instance: `drive:share-${short(init.nodeId)}`,
    intercept: false,
  })
  const unshareForms = new Map(
    init.shares.map((item) => [
      item.uid,
      bind(forms, driveUnshareForm(init.nodeId, item.uid, init.returnTo), {
        action: `${actionBase}?/unshare`,
        instance: `drive:unshare-${short(init.nodeId)}-${short(item.uid)}`,
        intercept: false,
      }),
    ]),
  )
</script>

<section class="flex flex-col gap-3 rounded-lg border border-border p-4" data-testid="drive-access">
  <h2 class="text-sm font-medium">Доступ</h2>
  {#if shares.length === 0}
    <p class="text-xs text-muted-foreground">Доступ никому не выдан: папку видит только владелец.</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each shares as item (item.uid)}
        <li class="flex items-center justify-between gap-2 text-sm">
          <span class="truncate font-mono text-xs">{item.uid}</span>
          <span class="flex items-center gap-2">
            <Badge variant="outline">{item.role === 'editor' ? 'редактор' : 'просмотр'}</Badge>
            {#if unshareForms.get(item.uid)}
              {@const unshare = unshareForms.get(item.uid)!}
              <Form form={unshare} hiddenFields={unshare.hidden()} class="inline">
                <Button type="submit" variant="ghost" size="sm">Отозвать</Button>
              </Form>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <Form form={share} hiddenFields={share.hidden()} class="flex flex-wrap items-end gap-2">
    <Field of={share.f.uid} />
    <Field of={share.f.role} />
    <Button type="submit" size="sm">Выдать доступ</Button>
  </Form>
</section>
