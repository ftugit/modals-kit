<script lang="ts" module>
  import { getContext, setContext } from 'svelte'
  import type { AvatarLimits } from './avatar.js'

  const AVATAR_TAKEOVER_CTX = Symbol('user/avatar-takeover-ctx')

  export interface AvatarTakeoverContext {
    readonly limits: () => AvatarLimits
    readonly existingAvatar: () => string | null
    readonly removeCurrent: () => boolean
    readonly onRemoveCurrent: () => void
  }

  export function setAvatarTakeoverContext(ctx: AvatarTakeoverContext): void {
    setContext(AVATAR_TAKEOVER_CTX, ctx)
  }

  export function getAvatarTakeoverContext(): AvatarTakeoverContext {
    return getContext<AvatarTakeoverContext>(AVATAR_TAKEOVER_CTX)
  }
</script>

<script lang="ts">
  /**
   * Заменяющий вид поля `avatar` для `FieldTakeover` (`base = FileField`).
   *
   * До оживления (и без JS) `Field.svelte` рисует штатный `FileField` с
   * именованным файловым носителем `avatar`, так что нативная отправка без JS
   * передаёт исходный файл на сервер как есть (`decodeWithNode`).
   *
   * В браузере с JS этот перехватчик берёт живую ручку `f: FieldHandle`:
   *   - компактный `FileAttachment` (`showFilename={false}`, `showSize={false}`)
   *     сразу показывает tile-превью и запускает `prepareAvatar` (`#lib/image`);
   *   - пока идёт конвертация, `f.pending = job` удерживает отправку формы;
   *   - готовый JPEG `File` записывается обратно в файловый носитель `avatar`
   *     через `DataTransfer`, после чего `bind.svelte.ts` перечитывает `FormData`
   *     и отправляет по сети уже сжатый бинарный `File` (никакого `base64`);
   *   - при отказе конвертации выбор очищается, `f.error` закрепляет ошибку у
   *     поля и блокирует отправку.
   */
  import { onDestroy, tick } from 'svelte'
  import type { FieldHandle } from '#lib/form/svelte/index.js'
  import { Attachment, AttachmentAction, FileAttachment } from '#components/ui/index.js'
  import { SERVER_PHOTO_FORMATS } from '../../checks.js'
  import { prepareAvatar } from './avatar.js'

  let { f }: { f: FieldHandle } = $props()

  const ctx = getAvatarTakeoverContext()

  let avatarFiles = $state<FileList | undefined>(undefined)
  let avatarBusy = $state(false)
  let activeAbort: AbortController | null = null

  const hasPickedFile = $derived(Boolean(avatarFiles && avatarFiles.length > 0))
  const visibleExisting = $derived(!hasPickedFile && !ctx.removeCurrent() ? ctx.existingAvatar() : null)

  onDestroy(() => {
    activeAbort?.abort()
    activeAbort = null
  })

  function onFileChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    const picked = input.files?.[0]

    activeAbort?.abort()
    activeAbort = null

    if (!picked) {
      avatarFiles = undefined
      avatarBusy = false
      f.pending = undefined
      f.error = undefined
      f.onInput(null)
      return
    }

    const controller = new AbortController()
    activeAbort = controller
    avatarBusy = true
    f.error = undefined

    const job = (async () => {
      try {
        const outcome = await prepareAvatar(picked, ctx.limits(), { signal: controller.signal })
        if (controller.signal.aborted) return
        if (outcome.ok) {
          const dt = new DataTransfer()
          dt.items.add(outcome.file)
          avatarFiles = dt.files
          await tick()
          f.onInput(outcome.file)
        } else {
          avatarFiles = undefined
          input.value = ''
          await tick()
          f.onInput(null)
          f.error = { code: outcome.code }
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
        avatarFiles = undefined
        input.value = ''
        await tick()
        f.onInput(null)
        f.error = { code: 'profile.avatar-format' }
      } finally {
        if (activeAbort === controller) {
          activeAbort = null
          avatarBusy = false
        }
      }
    })()

    f.pending = job
  }
</script>

<div class="space-y-1.5" data-field="avatar">
  <p class="text-sm">{f.label ?? 'Аватар'}</p>
  <FileAttachment
    name={f.name}
    id={String(f.attrs.id ?? '')}
    bind:files={avatarFiles}
    accept={SERVER_PHOTO_FORMATS.join(',')}
    size="sm"
    layout="tile"
    attachmentSize="sm"
    media="image"
    showFilename={false}
    showSize={false}
    onchange={onFileChange}
    onblur={() => f.setTouched()}
    disabled={avatarBusy || f.disabled}
  />
  {#if visibleExisting}
    {#snippet removeExistingActions()}
      <AttachmentAction
        aria-label="Удалить текущее фото"
        title="Удалить текущее фото"
        onclick={ctx.onRemoveCurrent}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-4"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </AttachmentAction>
    {/snippet}
    <Attachment
      previewUrl={visibleExisting}
      alt="Аватар"
      layout="tile"
      size="sm"
      media="image"
      showFilename={false}
      showSize={false}
      actions={removeExistingActions}
    />
  {/if}
  {#if f.errors[0]}
    <p role="alert" class="text-xs font-medium text-destructive">{f.errors[0].message}</p>
  {/if}
</div>
