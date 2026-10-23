<script lang="ts">
  // Страница меню пользователя — то же тело `MenuBody`, что и у модалки `user.menu`.
  // Гостевой доступ штатно закрыт `<Acl allow="user">` внутри `MenuBody`.
  import MenuBody from '#content/user/ui/MenuBody.svelte'

  let { data }: { data: { user: { prof: { nickname: string | null; avatarUrl: string | null } } | null } } = $props()
</script>

<div class="mx-auto w-full max-w-sm">
  <h1 class="mb-4 text-base font-semibold">Аккаунт</h1>
  <MenuBody server={data.user} variant="card" />
</div>
