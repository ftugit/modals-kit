<script lang="ts">
  /**
   * Универсальный экран управления пулом серверов боевого хранилища (`STORAGE_ACL`):
   * работает одинаково в модалке `storage.servers` и на странице `/storage-servers`.
   *
   * Читатели (`storage.read`) видят режим пула, подключённые слоты, замаскированные
   * сводки S3/WebDAV, приоритеты и квоты. Редакторы (`storage.edit` / `admin`) могут
   * добавлять, обновлять и удалять серверы с живой проверкой `probe` перед сохранением.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { grants } from '#lib/db/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import type { Result } from '#lib/form/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import { storageServer } from '#hooks/storage-db.js'
  import { forms } from '#components/form/forms.config.js'
  import Common from '#components/form/Common.svelte'
  import Field from '#components/form/Field.svelte'
  import { Badge, Button, Skeleton } from '#components/ui/index.js'
  import { cn } from '#components/utils.js'
  import type { AuthErrorCode } from '#content/user/error.js'
  import { useGrants } from '#content/user/grants.svelte.js'
  import Acl, { userSurfaceVariants, type UserSurfaceVariant } from '#content/user/ui/Acl.svelte'
  import { mirrorToField } from '#content/user/ui/field-mirror.svelte.js'
  import { userSession, vault } from '#content/user/vault.svelte.js'
  import { STORAGE_SERVER_FORM_ID, storageServerForm } from '../form.js'
  import type {
    StorageServersRouteData,
    StorageServersSlice,
    StorageServerView,
  } from '../types.js'

  const gStorageServer = grants(storageServer)

  interface Props {
    initial?: StorageServersRouteData | null
    action?: string
    form?: { result?: Result } | null
    authorized?: boolean
    enabled?: boolean
    doneHref?: string
    onAcl?: (fact: AuthErrorCode) => void
    onDone?: () => void
    variant?: UserSurfaceVariant
    class?: string
  }

  let {
    initial = null,
    action,
    form,
    authorized,
    enabled,
    doneHref = '/',
    onAcl,
    onDone,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const isAuthorized = $derived(authorized !== undefined ? authorized : vault.authorized)
  const isEnabled = $derived(enabled !== undefined ? enabled : initial?.enabled)
  const editGrant = useGrants(gStorageServer.insert)

  let routeData = $state<StorageServersRouteData | null>(untrack(() => initial))
  let editing = $state<StorageServerView | null>(null)
  let formResetTick = $state(0)
  let fetched = false

  $effect(() => {
    if (initial) {
      routeData = initial
      return
    }
    if (fetched) return
    fetched = true
    void (async () => {
      const r = await preloadData('/storage-servers')
      if (r.type !== 'loaded') {
        onAcl?.('auth.expired')
        return
      }
      const d = r.data as StorageServersRouteData
      if (d.fact) {
        onAcl?.(d.fact)
        return
      }
      routeData = d
    })()
  })

  const slice = $derived<StorageServersSlice | null>(routeData?.slice ?? null)
  const canEdit = $derived(
    vault.principal !== null ? editGrant.current : Boolean(slice?.canEdit),
  )

  const bound = bindComponentForm(forms, storageServerForm, {
    action: untrack(() => action),
    continuation: untrack(() => form?.result ?? undefined),
    session: userSession,
  })

  mirrorToField(bound as never, 'server_id', () => editing?.id ?? '')

  function loadIntoEditor(srv: StorageServerView | null) {
    editing = srv
    formResetTick += 1
    bound.f.server_id.onInput(srv?.id ?? '')
    bound.f.slot.onInput(srv?.slot ?? '')
    bound.f.url.onInput('')
    bound.f.encryption_key.onInput('')
    bound.f.clear_encryption_key.onInput(false)
    bound.f.storage_mb.onInput(String(srv?.meta.storageMb ?? 5120))
    bound.f.file_mb.onInput(String(srv?.meta.fileMb ?? 512))
    bound.f.priority.onInput(String(srv?.priority ?? 100))
    bound.f.allow_split.onInput(srv ? srv.meta.allowSplit : true)
    bound.f.read_only.onInput(srv ? srv.meta.readOnly : false)
  }

  let lastSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastSubmission) return
    const data = r.data as { step?: string; slice?: StorageServersSlice } | undefined
    if (data?.step === 'done' && data.slice) {
      lastSubmission = r.submissionId
      if (routeData) routeData = { ...routeData, slice: data.slice }
      loadIntoEditor(null)
    }
  })

  function modeBadgeText(mode: 'pool' | 'dev_local' | 'empty'): string {
    if (mode === 'pool') return 'Боевой пул БД'
    if (mode === 'dev_local') return 'Dev-фолбэк data/storage'
    return 'Пул пуст'
  }
</script>

<Acl
  allow="user"
  authorized={isAuthorized}
  enabled={isEnabled}
  backHref={doneHref}
  {variant}
  class={className}
>
  <section
    class={cn(
      'mx-auto flex w-full max-w-2xl flex-col gap-5 text-left',
      userSurfaceVariants({ variant }),
      className,
    )}
    data-testid="storage-servers-root"
  >
    {#if !slice}
      <div class="flex flex-col gap-3" aria-busy="true" data-testid="storage-servers-pending">
        <Skeleton class="h-6 w-56" />
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-36 w-full" />
      </div>
    {:else}
      <header class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex flex-col gap-1">
          <h2 class="text-base font-semibold">Серверы хранилища приложения</h2>
          <p class="text-xs text-muted-foreground">
            Пул S3 / WebDAV для пользовательских файлов и аватаров (учёт квот — pgStorageLedger, секреты запечатаны AUTH_SEAL_SECRET).
          </p>
        </div>
        <Badge
          variant={slice.activeMode === 'pool' ? 'default' : slice.activeMode === 'dev_local' ? 'secondary' : 'outline'}
          data-testid="storage-servers-mode"
        >
          {modeBadgeText(slice.activeMode)}
        </Badge>
      </header>

      <div class="flex flex-col gap-2.5" data-testid="storage-servers-list">
        {#if slice.items.length === 0}
          <div class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {#if slice.hasDevFallback}
              В БД пока нет серверов S3 / WebDAV — в локальном окружении запись идёт в папку
              <code class="rounded bg-muted px-1 py-0.5 text-xs">data/storage</code>.
            {:else}
              В боевом пуле нет подключённых серверов. Добавьте S3 или WebDAV-сервер ниже.
            {/if}
          </div>
        {:else}
          {#each slice.items as srv (srv.id)}
            <div
              class="flex flex-col gap-2 rounded-lg border border-border p-3"
              data-testid={`storage-server-card-${srv.slot}`}
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-mono text-sm font-semibold">{srv.slot}</span>
                  <Badge variant="outline">{srv.meta.protocol.toUpperCase()}</Badge>
                  <Badge variant="outline">Приоритет {srv.priority}</Badge>
                  {#if srv.meta.encrypted}
                    <Badge variant="secondary">AES-256-GCM</Badge>
                  {/if}
                  {#if srv.meta.readOnly}
                    <Badge variant="outline">Только чтение</Badge>
                  {/if}
                  {#if !srv.meta.allowSplit}
                    <Badge variant="outline">Без split</Badge>
                  {/if}
                </div>
                {#if canEdit}
                  <div class="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onclick={() => loadIntoEditor(srv)}
                      data-testid={`storage-server-edit-${srv.slot}`}
                    >
                      Изменить
                    </Button>
                    <Form
                      id={`${STORAGE_SERVER_FORM_ID}-del-${srv.id}`}
                      form={bound}
                      hiddenFields={bound.hidden()}
                    >
                      <Button
                        type="submit"
                        name="intent"
                        value={`delete:${srv.id}`}
                        variant="ghost"
                        size="sm"
                        task={formTask(bound.state, `delete:${srv.id}`)}
                        data-testid={`storage-server-delete-${srv.slot}`}
                      >
                        Удалить
                      </Button>
                    </Form>
                  </div>
                {/if}
              </div>
              <p class="truncate font-mono text-xs text-muted-foreground">{srv.meta.summary}</p>
              <p class="text-xs text-muted-foreground">
                Квота: {srv.meta.storageMb} МБ · Макс. файл: {srv.meta.fileMb} МБ
              </p>
            </div>
          {/each}
        {/if}
      </div>

      {#if canEdit}
        <Form
          id={STORAGE_SERVER_FORM_ID}
          form={bound}
          hiddenFields={bound.hidden()}
          class="flex flex-col gap-3 rounded-lg border border-border p-4"
          data-testid="storage-server-form"
          data-reset-tick={formResetTick}
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">
              {editing ? `Обновить сервер «${editing.slot}»` : 'Подключить сервер (S3 / WebDAV)'}
            </h3>
            {#if editing}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onclick={() => loadIntoEditor(null)}
              >
                Новый слот
              </Button>
            {/if}
          </div>

          <Common errors={bound.common} title="Не удалось сохранить сервер" />

          <div hidden aria-hidden="true"><Field of={bound.f.server_id} /></div>

          {#if !editing}
            <Field of={bound.f.slot} />
          {/if}
          <Field of={bound.f.url} />
          <Field of={bound.f.encryption_key} />
          {#if editing?.meta.encrypted}
            <Field of={bound.f.clear_encryption_key} />
          {/if}

          <div class="grid gap-3 sm:grid-cols-3">
            <Field of={bound.f.storage_mb} />
            <Field of={bound.f.file_mb} />
            <Field of={bound.f.priority} />
          </div>

          <Field of={bound.f.allow_split} />
          <Field of={bound.f.read_only} />

          <div class="flex items-center justify-between gap-2 pt-1">
            <Button
              type="submit"
              name="intent"
              value="save"
              task={formTask(bound.state, 'save')}
              data-testid="storage-server-save"
            >
              {editing ? 'Проверить и обновить' : 'Проверить и добавить'}
            </Button>
            {#if onDone}
              <Button
                type="button"
                variant="ghost"
                onclick={() => onDone()}
              >
                Закрыть
              </Button>
            {/if}
          </div>
        </Form>
      {:else if onDone}
        <div class="flex justify-end">
          <Button type="button" variant="ghost" onclick={() => onDone()}>
            Закрыть
          </Button>
        </div>
      {/if}
    {/if}
  </section>
</Acl>
