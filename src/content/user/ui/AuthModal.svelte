<script lang="ts">
  /**
   * Виджет авторизации в модалке (`?modal=user.auth`). Данные для виджета —
   * loader определения (fetch load-данных роута `/user/auth`); callback —
   * закрытие именно модалки (решение владельца).
   */
  import { useModals } from '#lib/modals/svelte/index.js'
  import AuthWidget from './AuthWidget.svelte'

  let { data }: { data: Record<string, unknown> } = $props()

  const m = useModals()
</script>

<div class="p-5">
  <AuthWidget
    data={data as never}
    form={null}
    mode="modal"
    onDone={() => m.modals.close()}
  />
</div>
