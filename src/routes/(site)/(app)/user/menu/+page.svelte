<script lang="ts">
  // Страница меню пользователя — буквально тот же компонент `MenuBody`, что и
  // у модалки `user.menu`. Снимок пользователя читается напрямую из единого `vault`.
  import MenuBody from '#content/user/ui/MenuBody.svelte'
</script>

<div class="mx-auto w-full max-w-sm">
  <h1 class="mb-4 text-base font-semibold">Аккаунт</h1>
  <MenuBody variant="card" />
</div>
