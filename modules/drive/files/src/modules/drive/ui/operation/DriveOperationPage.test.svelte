<script lang="ts">
  /** Тестовая страница: та же оболочка, что у standalone-операций, с кукольным контролом. */
  import type { DriveOperationData } from '../../types.js'
  import DriveOperationPage from './DriveOperationPage.svelte'

  let { data }: { data: DriveOperationData } = $props()
</script>

<DriveOperationPage {data}>
  <div data-testid="op-field">Имя</div>
  <button type="button">Сохранить</button>
</DriveOperationPage>
