<script lang="ts" generics="TMeta = Record<string, unknown>">
  /**
   * Универсальная оболочка куки-сейфа демо-стендов (по аналогии с `FiltersPanel`):
   * схема данных (`schema.form`) задаётся экземпляром, оболочка рисует общую
   * форму сервера, список слотов, удаление и сброс ключа `dv_key` как действие
   * той же формы — и в модалке, и на отдельном роуте (без JS).
   */
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import { forms } from '#components/form/forms.config.js'
  import StorageServerForm from '#components/storage-servers/StorageServerForm.svelte'
  import { Badge, Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import type {
    CookieVaultMaskedItem,
    CookieVaultSchema,
    CookieVaultSnapshot,
  } from '#hooks/cookie-vault/index.js'
  import { asLink } from '#hooks/links/index.js'
  import { formTask } from '#lib/form/svelte/index.js'
  import CookieVaultDeleteButton from './CookieVaultDeleteButton.svelte'

  interface Props<M> {
    schema: CookieVaultSchema<unknown, M>
    snapshot: CookieVaultSnapshot<M>
    /** Подпись отправки слота. Проверка подключения — это сама отправка, отдельной кнопки нет. */
    submitLabel?: string
    entryTitle?: string
    entryTestId?: string
    submitTestId?: string
    /** Необязательный рендер публичных метаданных слота (лимиты, флаги и т.п.). */
    renderMeta?: Snippet<[CookieVaultMaskedItem<M>]>
    /** Ссылка возврата на демо-страницу (для отдельного роута-фолбэка без JS). */
    backHref?: string
    /** Вызывается при любом изменении сейфа (сохранение, удаление, сброс ключа). */
    onChanged?: (next: CookieVaultSnapshot<M>) => void
    class?: string
  }

  let {
    schema,
    snapshot,
    submitLabel = 'Проверить и сохранить',
    entryTitle = 'Добавить или обновить сервер (S3 / WebDAV)',
    entryTestId = 'storage-vault-entry-form',
    submitTestId = 'vault-save-submit',
    renderMeta,
    backHref,
    onChanged,
    class: cls = '',
  }: Props<TMeta> = $props()

  let live = $state<CookieVaultSnapshot<TMeta>>(untrack(() => snapshot))
  let formEpoch = $state(0)

  $effect(() => {
    live = snapshot
  })

  function applyNext(next: CookieVaultSnapshot<TMeta>, bumpForm = false) {
    live = next
    if (bumpForm) formEpoch += 1
    onChanged?.(next)
  }

  const initialSchema = untrack(() => schema)
  const bound = bindComponentForm(forms, initialSchema.form, {
    instance: `dv_entry:${initialSchema.scope}`,
    onSuccess: (res) => {
      const payload = res.data as { snapshot?: CookieVaultSnapshot<TMeta> } | undefined
      if (payload?.snapshot) applyNext(payload.snapshot, true)
      for (const field of initialSchema.form.fields) {
        bound.f[field.name]?.onInput(field.defaultValue ?? '')
      }
    },
  })
</script>

<div
  class={`flex min-h-0 flex-auto flex-col text-sm ${cls}`}
  data-testid="cookie-vault"
  data-vault-scope={schema.scope}
>
  <div class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
    <div class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg font-semibold leading-tight tracking-tight">{schema.title}</h2>
        <Badge
          variant={live.hasKey ? 'secondary' : 'outline'}
          class="font-mono"
          data-testid="vault-key-status"
        >
          {live.hasKey ? 'ключ dv_key активен' : 'ключ не создан'} · {live.items.length}/{live.maxEntries}
        </Badge>
      </div>
      {#if schema.description}
        <p class="text-sm text-muted-foreground">{schema.description}</p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      {#if live.hasKey || live.items.length > 0}
        <Button
          type="submit"
          form={schema.form.id}
          {...bound.intent('reset-key')}
          variant="destructive"
          size="sm"
          task={formTask(bound.state, 'reset-key')}
          data-testid="vault-reset-key"
        >
          Сбросить ключ и куки
        </Button>
      {/if}
      {#if backHref}
        <Button {...asLink(backHref)} variant="ghost" size="sm" data-testid="vault-back-link">
          ← К демо
        </Button>
      {/if}
    </div>
  </div>

  <div
    class="flex min-h-0 flex-auto flex-col gap-5 overflow-y-auto overscroll-contain pt-4 pr-1"
    data-testid="cookie-vault-scroll"
  >
    <div class="flex flex-col gap-2">
      <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Сохранённые конфиги ({live.items.length})
      </h3>

      {#if live.items.length === 0}
        <p
          class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
          data-testid="vault-empty"
        >
          В куках браузера пока нет сохранённых конфигов этого раздела.
        </p>
      {:else}
        <ul class="flex flex-col gap-2" data-testid="vault-items-list">
          {#each live.items as item (item.id)}
            <li
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3.5"
              data-testid="vault-item"
              data-slot-id={item.id}
            >
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold" data-testid="vault-item-label">{item.label}</span>
                  <code
                    class="truncate rounded bg-muted px-1.5 py-0.5 text-xs"
                    data-testid="vault-item-summary"
                  >
                    {item.summary}
                  </code>
                </div>
                {#if renderMeta}
                  <div class="text-xs text-muted-foreground">
                    {@render renderMeta(item)}
                  </div>
                {/if}
              </div>

              <CookieVaultDeleteButton
                {schema}
                slotId={item.id}
                onDeleted={(next) => applyNext(next, false)}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="border-t border-border/60 pt-4 pb-1">
      {#key formEpoch}
        <StorageServerForm
          form={bound}
          formId={schema.form.id}
          {submitLabel}
          title={entryTitle}
          formTestId={entryTestId}
          {submitTestId}
        />
      {/key}
    </div>
  </div>
</div>
