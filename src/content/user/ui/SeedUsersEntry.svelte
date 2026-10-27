<script lang="ts">
  /**
   * Точка входа в список seed-юзеров на главной — только для авторизованных.
   *
   * Видимость — по факту входа (`vault.authorized`), а не через `Acl`: гостю
   * блок не нужен вовсе, а `Acl allow="user"` нарисовал бы ему карточку
   * «Войти» посреди главной. Права на сам список здесь не проверяются (в
   * клиентском `vault` их нет): о них скажет экран списка — одинаково в
   * модалке и на странице.
   *
   * Кнопка одна на оба носителя (канон `useModalLink`): с JS — модалка
   * `user.list`, без JS — обычная ссылка на `/users` (адрес явный: у
   * модалки маршрутной загрузки нет, данные запрашивает сам список).
   */
  import { Button } from '#components/ui/index.js'
  import { useModalLink } from '#hooks/links/index.js'
  import { vault } from '../vault.svelte.js'
  import { userListRoute } from '../routes.js'

  const asModalLink = useModalLink()
  const authorized = $derived(vault.authorized)
</script>

{#if authorized}
  <section
    class="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
    data-testid="seed-users-entry"
  >
    <h2 class="text-xl font-semibold tracking-tight">Seed-юзеры</h2>
    <p class="my-4 text-sm leading-relaxed text-muted-foreground">
      Список аккаунтов по seed. Виден администратору и обладателям права на чтение аккаунтов —
      экран сам скажет, если права нет.
    </p>
    <Button {...asModalLink('user.list', {}, { href: userListRoute.href() })}>Открыть список</Button>
  </section>
{/if}
