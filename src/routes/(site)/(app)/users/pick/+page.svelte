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
  {#if data.fact === 'auth.forbidden'}
    <Acl model="forbidden" backHref={data.fromHref} />
  {:else if data.fact}
    <Acl status={data.fact} backHref={data.fromHref} />
  {:else}
    <div class="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <UserPicker
        mode={data.mode}
        initialPicked={data.picked}
        initialUsers={data.initialUsers}
        fromHref={data.fromHref}
        targetParam={data.targetParam}
      />
    </div>
  {/if}
</div>
