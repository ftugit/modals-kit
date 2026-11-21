<script lang="ts">
  /**
   * Универсальный экран управления пулом серверов боевого хранилища (`STORAGE_ACL`):
   * работает одинаково в модалке `storage.servers` и на странице `/storage-servers`.
   *
   * Читатели (`storage.read`) видят режим пула, подключённые слоты, замаскированные
   * сводки S3/WebDAV, приоритеты и квоты. Редакторы (`storage.edit` / `admin`) могут
   * добавлять, обновлять и удалять серверы с живой проверкой `probe` перед сохранением.
   *
   * Все кнопки отправки (`save` и `delete:<id>`) живут внутри одной общей `<Form>`,
   * чтобы `bind()` держал единственный `formEl` для живых проверок `recheck`/`syncPins`.
   */
  import { preloadData } from '$app/navigation'
  import { untrack } from 'svelte'
  import { grants } from '#core/lib/db/index.js'
  import { formTask } from '#core/lib/form/svelte/index.js'
  import type { Result } from '#core/lib/form/index.js'
  import { bindComponentForm } from '#core/hooks/component-form/index.js'
  import { storageServer } from '#core/hooks/storage-schema.js'
  import { forms } from '#core/ui/form/forms.config.js'
  import StorageServerForm from '#modules/storage-servers/ui/StorageServerForm.svelte'
  import ServerCard from './storage-servers/ServerCard.svelte'
  import { Badge, Button, Skeleton, Surface } from '#core/ui/index.js'
  import { cn } from '#core/ui/utils.js'
  import type { AuthErrorCode } from '#modules/user/base/model/error.js'
  import { useGrants } from '#modules/user/base/svelte/grants.svelte.js'
  import Acl, { type UserSurfaceVariant } from '#modules/user/base/svelte/Acl.svelte'
  import { mirrorToField } from '#modules/user/base/svelte/field-mirror.svelte.js'
  import { userSession, vault } from '#modules/user/base/svelte/vault.svelte.js'
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
    onChange?: (next: StorageServersSlice) => void
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
    onChange,
    onDone,
    variant = 'plain',
    class: className,
  }: Props = $props()

  const isAuthorized = $derived(authorized !== undefined ? authorized : vault.authorized)
  const isEnabled = $derived(enabled !== undefined ? enabled : initial?.enabled)
  const editGrant = useGrants(gStorageServer.insert)

  let routeData = $state<StorageServersRouteData | null>(untrack(() => initial))
  let editing = $state<StorageServerView | null>(null)
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

  // Синхронный засев на SSR / no-JS при `?edit=<id>` и реактивный отклик на смену `initial.editId`
  let lastSeededEditId = untrack(() => {
    const initEditId = initial?.editId ?? null
    if (initEditId && initial?.slice && !bound.state.result) {
      const target = initial.slice.items.find((x) => x.id === initEditId) ?? null
      if (target) loadIntoEditor(target)
    }
    return initEditId
  })

  $effect(() => {
    const nextEditId = initial?.editId ?? null
    const items = initial?.slice?.items
    if (nextEditId === lastSeededEditId) return
    lastSeededEditId = nextEditId
    untrack(() => {
      const target = nextEditId && items ? (items.find((x) => x.id === nextEditId) ?? null) : null
      loadIntoEditor(target)
    })
  })

  let lastSubmission = ''
  $effect(() => {
    const r = bound.state.result
    if (!r?.ok || r.submissionId === lastSubmission) return
    const data = r.data as { step?: string; slice?: StorageServersSlice } | undefined
    if (data?.step === 'done' && data.slice) {
      lastSubmission = r.submissionId
      if (routeData) routeData = { ...routeData, slice: data.slice }
      loadIntoEditor(null)
      onChange?.(data.slice)
    }
  })

  function modeBadgeText(mode: 'pool' | 'dev_local' | 'empty'): string {
    if (mode === 'pool') return 'Боевой пул БД'
    if (mode === 'dev_local') return 'Dev-фолбэк data/storage'
    return 'Пул пуст'
  }
</script>

{#snippet serverList(currentSlice: StorageServersSlice, editable: boolean)}
  <div class="flex flex-col gap-2.5" data-testid="storage-servers-list">
    {#if currentSlice.items.length === 0}
      <div class="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        {#if currentSlice.hasDevFallback}
          В БД пока нет серверов S3 / WebDAV — в локальном окружении запись идёт в папку
          <code class="rounded bg-muted px-1 py-0.5 text-xs">data/storage</code>.
        {:else}
          В боевом пуле нет подключённых серверов. Добавьте S3 или WebDAV-сервер ниже.
        {/if}
      </div>
    {:else}
      {#each currentSlice.items as srv (srv.id)}
        <ServerCard {srv}>
          {#snippet actions()}
            {#if editable}
              {#if onDone}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onclick={() => loadIntoEditor(srv)}
                  data-testid={`storage-server-edit-${srv.slot}`}
                >
                  Изменить
                </Button>
              {:else}
                <Button
                  href={`/storage-servers?edit=${encodeURIComponent(srv.id)}`}
                  variant="outline"
                  size="sm"
                  onclick={(e: MouseEvent) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                    e.preventDefault()
                    loadIntoEditor(srv)
                  }}
                  data-testid={`storage-server-edit-${srv.slot}`}
                >
                  Изменить
                </Button>
              {/if}
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
            {/if}
          {/snippet}
        </ServerCard>
      {/each}
    {/if}
  </div>
{/snippet}

{#snippet storageHint()}
  <p class="text-xs text-muted-foreground">
    Пул S3 / WebDAV для пользовательских файлов и аватаров (учёт квот — pgStorageLedger, секреты запечатаны AUTH_SEAL_SECRET).
  </p>
{/snippet}

{#snippet modeBadge()}
  {#if slice}
    <Badge
      variant={slice.activeMode === 'pool' ? 'default' : slice.activeMode === 'dev_local' ? 'secondary' : 'outline'}
      data-testid="storage-servers-mode"
    >
      {modeBadgeText(slice.activeMode)}
    </Badge>
  {/if}
{/snippet}

<Acl
  allow="user"
  authorized={isAuthorized}
  enabled={isEnabled}
  backHref={doneHref}
  {variant}
  class={className}
>
  <Surface
    {variant}
    class={cn('mx-auto w-full max-w-2xl p-4 sm:p-6', className)}
    title="Серверы хранилища приложения"
    description={storageHint}
    controls={slice ? modeBadge : undefined}
    data-testid="storage-servers-root"
  >
    {#if !slice}
      <div class="flex flex-col gap-3" aria-busy="true" data-testid="storage-servers-pending">
        <Skeleton class="h-6 w-56" />
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-36 w-full" />
      </div>
    {:else}
      {#if canEdit}
        <StorageServerForm
          form={bound}
          formId={STORAGE_SERVER_FORM_ID}
          withPriority
          editId={editing?.id ?? null}
          showClearKey={Boolean(editing?.meta.encrypted)}
          title={editing ? `Обновить сервер «${editing.slot}»` : 'Подключить сервер (S3 / WebDAV)'}
          submitLabel={editing ? 'Проверить и обновить' : 'Проверить и добавить'}
        >
          {@render serverList(slice, true)}
          {#snippet controls()}
            {#if editing}
              {#if onDone}
                <Button type="button" variant="ghost" size="sm" onclick={() => loadIntoEditor(null)}>
                  Новый слот
                </Button>
              {:else}
                <Button
                  href="/storage-servers"
                  variant="ghost"
                  size="sm"
                  onclick={(e: MouseEvent) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                    e.preventDefault()
                    loadIntoEditor(null)
                  }}
                >
                  Новый слот
                </Button>
              {/if}
            {/if}
          {/snippet}
          {#snippet actions()}
            {#if onDone}
              <Button type="button" variant="ghost" onclick={() => onDone()}>
                Закрыть
              </Button>
            {/if}
          {/snippet}
        </StorageServerForm>
      {:else}
        {@render serverList(slice, false)}
        {#if onDone}
          <div class="flex justify-end">
            <Button type="button" variant="ghost" onclick={() => onDone()}>
              Закрыть
            </Button>
          </div>
        {/if}
      {/if}
    {/if}
  </Surface>
</Acl>
