<script lang="ts">
  // Секция «Аккаунт»: тот же экран настроек, но без собственных Acl/Surface —
  // их держит SettingsHost. Шаги профиля/безопасности/сессий остаются внутри.
  import { UserConfig } from './index.js'
  import type { SettingsSectionProps } from '#core/ui/settings/index.js'
  import type { UserSettingsScreen } from './host-screen.js'

  let { ctx, screen }: SettingsSectionProps<UserSettingsScreen> = $props()
</script>

<UserConfig embedded uid={ctx.uid} {...screen} />
