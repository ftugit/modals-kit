// Шаг настроек «Пароли WebDAV»: сам экран — `/user/config/dav`, шаг лишь
// открывает его из настроек. Подхватывается glob'ом `/src/modules/**/config.ext.ts`.
import { registerConfigStep } from '#modules/user/base/svelte/user-config/extensions.js'
import DriveDavTokensStep from './ui/DriveDavTokensStep.svelte'

registerConfigStep({ id: 'dav', component: DriveDavTokensStep, group: 'security', label: 'WebDAV', ownOnly: true })
