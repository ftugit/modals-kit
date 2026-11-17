// Расширение настроек: сессии сами объявляют свой встроенный шаг.
// Подхватывается glob'ом `/src/modules/**/config.ext.ts` в layout сайта.
import { registerConfigStep } from '#modules/user/base/svelte/user-config/extensions.js'
import UserConfigSessionsStep from './UserConfigSessionsStep.svelte'

registerConfigStep({ id: 'sessions', component: UserConfigSessionsStep })
