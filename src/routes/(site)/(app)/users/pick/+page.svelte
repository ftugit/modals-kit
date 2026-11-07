<script lang="ts">
  // Страница пикера пользователей — носитель пары `user.picker`.
  import { useHeadSeo } from '#components/shell/index.js'
  import Acl from '#content/user/ui/Acl.svelte'
  import UserPicker from '#content/user/ui/UserPicker.svelte'
  import type { PageProps } from './$types'

  let { data }: PageProps = $props()

  useHeadSeo(() => ({
    subTitle: data.mode === 'single' ? 'Выбор пользователя' : 'Выбор пользователей',
    description: 'Выбор аккаунтов пользователей из списка.',
    noindex: true,
  }))
</script>

<div class="mx-auto w-full max-w-2xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={data.fromHref} />
  {:else}
    <UserPicker
      mode={data.mode}
      initialPicked={data.picked}
      initialUsers={data.initialUsers}
      fromHref={data.fromHref}
      targetParam={data.targetParam}
    />
  {/if}
</div>
