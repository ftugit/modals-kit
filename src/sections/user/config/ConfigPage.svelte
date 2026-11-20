<script lang="ts">
  // Страница своих настроек (`/user/config`) — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { SettingsHost } from '#modules/user/base/svelte/user-config/index.js'
  import type { UserConfigRouteData } from '#modules/user/base/index.js'

  let { data }: { data: UserConfigRouteData } = $props()

  useHeadSeo({
    subTitle: 'Настройки',
    description: 'Персональные настройки аккаунта и приватности профиля.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-3xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={'/'} />
  {:else}
    <SettingsHost
      initial={data}
      enabled={data.enabled}
      authorized={Boolean(data.slice)}
      doneHref={data.uid ? `/user/${data.uid}` : '/'}
      action={`/user/config?next=${encodeURIComponent(data.uid ? `/user/${data.uid}` : '/')}`}
      stepsMode="hybrid"
    />
  {/if}
</div>
