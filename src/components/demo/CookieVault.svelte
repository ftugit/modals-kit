<script lang="ts" generics="TMeta = Record<string, unknown>">
  /**
   * Универсальная оболочка куки-сейфа демо-стендов (по аналогии с `FiltersPanel`):
   * схема данных (`schema`) и UI-компонент формы добавления (`form`) задаются
   * каждым экземпляром отдельно, а оболочка берёт на себя список маскированных
   * слотов, удаление слота, мгновенный сброс куки-ключа `dv_key` и навигацию
   * как в модалке, так и на отдельном роуте (без JS).
   */
  import type { Component, Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import Field from '#components/form/Field.svelte'
  import { forms } from '#components/form/forms.config.js'
  import { Button } from '#components/ui/index.js'
  import { bindComponentForm } from '#hooks/component-form/index.js'
  import type {
    CookieVaultFormProps,
    CookieVaultMaskedItem,
    CookieVaultSchema,
    CookieVaultSnapshot,
  } from '#hooks/cookie-vault/index.js'
  import { asLink } from '#hooks/links/index.js'
  import { Form, formTask } from '#lib/form/svelte/index.js'
  import CookieVaultDeleteButton from './CookieVaultDeleteButton.svelte'

  interface Props<M> {
    schema: CookieVaultSchema<unknown, M>
    snapshot: CookieVaultSnapshot<M>
    /** Пользовательский UI-компонент формы этого экземпляра сейфа (как `form` в `FiltersPanel`). */
    form: Component<CookieVaultFormProps<M>>
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
    form: VaultEntryForm,
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
  const resetForm = bindComponentForm(forms, initialSchema.resetKeyForm, {
    instance: `dv_reset:${initialSchema.scope}`,
    onSuccess: (res) => {
      const payload = res.data as { snapshot?: CookieVaultSnapshot<TMeta> } | undefined
      if (payload?.snapshot) applyNext(payload.snapshot, true)
    },
  })
</script>

<div
  class={`flex min-h-0 flex-auto flex-col text-sm ${cls}`}
  data-testid="cookie-vault"
  data-vault-scope={schema.scope}
>
  <div class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
    <div class="space-y-1">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-base font-semibold">{schema.title}</h2>
        <span
          class="rounded bg-muted px-2 py-0.5 font-mono text-xs"
          data-testid="vault-key-status"
        >
          {live.hasKey ? 'ключ dv_key активен' : 'ключ не создан'} · {live.items.length}/{live.maxEntries}
        </span>
      </div>
      {#if schema.description}
        <p class="text-xs text-muted-foreground">{schema.description}</p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      {#if live.hasKey || live.items.length > 0}
        <Form form={resetForm} hiddenFields={resetForm.hidden()} class="inline-flex">
          <Field of={resetForm.f.confirm_scope} />
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            task={formTask(resetForm.state)}
            data-testid="vault-reset-key"
          >
            Сбросить ключ и куки
          </Button>
        </Form>
      {/if}
      {#if backHref}
        <a
          {...asLink(backHref)}
          class="text-xs font-medium underline underline-offset-4 hover:text-primary"
          data-testid="vault-back-link"
        >
          ← К демо
        </a>
      {/if}
    </div>
  </div>

  <div
    class="min-h-0 flex-auto space-y-5 overflow-y-auto overscroll-contain pt-4 pr-1"
    data-testid="cookie-vault-scroll"
  >
    <div class="space-y-2">
      <h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Сохранённые конфиги ({live.items.length})
      </h3>

      {#if live.items.length === 0}
        <p
          class="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground"
          data-testid="vault-empty"
        >
          В куках браузера пока нет сохранённых конфигов этого раздела.
        </p>
      {:else}
        <ul class="space-y-2" data-testid="vault-items-list">
          {#each live.items as item (item.id)}
            <li
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3"
              data-testid="vault-item"
              data-slot-id={item.id}
            >
              <div class="min-w-0 space-y-0.5">
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
        <VaultEntryForm
          config={forms}
          {schema}
          items={live.items}
          onSaved={(next) => applyNext(next, true)}
        />
      {/key}
    </div>
  </div>
</div>
