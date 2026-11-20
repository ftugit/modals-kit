// Пункты настроек модуля: имя и компонент назначает модуль.
// Автоподхватывается glob'ом `/src/modules/**/settings.ext.ts` в layout сайта.
import { registerSettingsSection } from '#core/ui/settings/index.js'
import AccountSection from './user-config/AccountSection.svelte'

registerSettingsSection({
  id: 'account',
  label: 'Аккаунт',
  order: 10,
  component: AccountSection,
})
