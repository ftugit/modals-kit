<script module lang="ts">
  /**
   * База подмены: производное поле декларирует свой примитив-основу module-экспортом.
   * `Field` включает подмену только при `instead.base === Input` — под полем может
   * оказаться лишь `Input` и производные от него (поле + свои кнопки/действия).
   */
  import Input from '#components/ui/input/Input.svelte'

  export const base = Input
</script>

<script lang="ts">
  // Поле с копированием содержимого: примитив `CopyInput` (Input + кнопка и логика
  // копирования в его файле) внутри штатной обёртки поля — подпись, подсказка и
  // ошибки остаются у движка формы. Образец композиции — `PasswordField`.
  import { CopyInput } from '#components/ui/index.js'
  import type { FieldView } from '#lib/form/svelte/index.js'
  import FieldShell from './FieldShell.svelte'

  let f: FieldView = $props()
</script>

<FieldShell {f}>
  <CopyInput
    {...f.attrs}
    value={String(f.value ?? '')}
    autocomplete="off"
    spellcheck="false"
    copyLabel="Копировать"
    copiedLabel="Скопировано"
    onblur={() => f.setTouched()}
    oninput={(e) => f.onInput(e.currentTarget.value)}
  />
</FieldShell>
