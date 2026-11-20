<script lang="ts">
  // Настройки пользователя по UUID — section-компонент (тонкий носитель в route).
  import { useHeadSeo } from '#core/ui/shell/index.js'
  import Acl from '#modules/user/base/svelte/Acl.svelte'
  import { SettingsHost } from '#modules/user/base/svelte/user-config/index.js'
  import type { UserConfigRouteData } from '#modules/user/base/index.js'

  let { data }: { data: UserConfigRouteData } = $props()
  const backHref = $derived(data.uid ? `/user/${data.uid}` : '/')

  useHeadSeo({
    subTitle: 'Настройки пользователя',
    description: 'Просмотр и изменение настроек выбранного пользователя.',
    noindex: true,
  })
</script>

<div class="mx-auto w-full max-w-3xl">
  {#if data.fact}
    <Acl status={data.fact} enabled={data.enabled} backHref={data.fact === 'auth.identity-unknown' ? '/' : backHref} />
  {:else}
    <SettingsHost
      uid={data.uid}
      initial={data}
      enabled={data.enabled}
      authorized={Boolean(data.slice)}
      doneHref={backHref}
      action={`/user/${data.uid}/config?next=${encodeURIComponent(backHref)}`}
      stepsMode="hybrid"
    />
  {/if}
</div>
