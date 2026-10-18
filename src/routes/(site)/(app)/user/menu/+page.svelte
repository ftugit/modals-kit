<script lang="ts">
  // Страница меню пользователя — то же тело, что у модалки `user.menu`
  // (решение владельца, ход 261: выпадашка и роут — БУКВАЛЬНО ОДИН компонент).
  // Без JS ссылка аватара в шапке ведёт сюда: здесь есть выход.
  import MenuBody from '#content/user/ui/MenuBody.svelte'

  let { data }: { data: { user: { prof: { nickname: string | null; avatarUrl: string | null } } } } = $props()
</script>

<div class="mx-auto w-full max-w-sm p-6">
  <h1 class="mb-4 text-base font-semibold">Аккаунт</h1>
  <div class="rounded-xl border bg-card">
    <MenuBody server={data.user} />
  </div>
</div>
