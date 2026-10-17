<script lang="ts">
  /**
   * Места набора полей — разметка приложения. Библиотека даёт места и пропсы кнопок
   * (`fieldSet`), а где цикл, где «+ поле», какие обёртки и классы — решается здесь.
   * Без JavaScript «+ поле» и «Удалить» отправляют форму: сервер возвращает места,
   * ничего не сохраняя.
   */
  import { fieldSet, type BoundForm } from '#lib/form/svelte/index.js'
  import { Button } from '#lib/components/ui/index.js'
  import Field from '#lib/components/form/Field.svelte'

  let { form, name }: { form: BoundForm; name: string } = $props()

  const RULE_LABEL: Record<string, string> = {
    required: 'Обязательное', minLength: 'Мин. длина', maxLength: 'Макс. длина',
    minValue: 'Мин. значение', maxValue: 'Макс. значение', integer: 'Целое число',
  }
  /**
   * Правила вида, которые снять нельзя. Показываются ВНУТРИ списка «Правила»
   * выбранным пунктом — картинка того, что каталог добавит полю сам.
   */
  const LOCKED_LABEL: Record<string, string> = {
    email: 'Всегда: проверка адреса почты',
    url: 'Всегда: проверка ссылки',
    pattern: 'Всегда: номер в формате +79991234567',
  }

  // svelte-ignore state_referenced_locally
  const set = fieldSet(form, name, {
    labels: { label: 'Название поля', kind: 'Вид', rules: 'Правила' },
    rule: (r) => RULE_LABEL[r] ?? LOCKED_LABEL[r] ?? r,
    placeholder: 'например, «Ссылка»',
  })
  const f = $derived(form.f[name])
</script>

<div class="space-y-3" data-field={name}>
  <div>
    <p class="text-sm font-medium">{f?.label}</p>
    {#if f?.help}<p class="text-xs text-muted-foreground">{f.help}</p>{/if}
  </div>
  {#each set.errors as e (e.id)}<p class="text-xs font-medium text-destructive" role="alert">{e.message}</p>{/each}

  {#each set.rows as row, i (row.key)}
    <div data-set-row={row.key} class="space-y-3 rounded-lg border border-border p-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium">Поле {i + 1}</span>
        <Button variant="ghost" size="xs" data-testid="remove-{row.key}" {...set.removeProps(row)}>Удалить</Button>
      </div>
      {#each row.errors as e (e.id)}<p class="text-xs font-medium text-destructive" role="alert">{e.message}</p>{/each}
      <div class="grid gap-3 sm:grid-cols-2">
        <Field of={row.label} />
        <Field of={row.kind} />
      </div>
      <Field of={row.rules} />
      {#if row.args.length}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each row.args as a (a.name)}<Field of={a} />{/each}
        </div>
      {/if}
    </div>
  {/each}

  <Button variant="outline" size="sm" data-testid="add-field" {...set.addProps()}>+ поле</Button>
</div>
