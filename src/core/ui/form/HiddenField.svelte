<script lang="ts">
  // Скрытое поле: только имя и значение из `attrs` (type="hidden"). Подписи,
  // подсказки и текста ошибки нет — человеку показывать нечего.
  import { Input } from '#core/ui/index.js'
  import type { FieldView } from '#core/lib/form/svelte/index.js'

  let f: FieldView = $props()
  // Пусто — значение по умолчанию из описания: связка его в состояние не кладёт.
  const value = $derived(f.attrs.value === '' || f.attrs.value === undefined ? (f.defaultValue ?? '') : f.attrs.value)
</script>

<Input {...f.attrs} type="hidden" {value} />
