/**
 * Универсальная демо-панель (`#components/demo`) — один компонент на все
 * демо-страницы. Схема полей — данные; адрес (seed, коммит, бронь ключей, GET
 * без JS) панель подключает сама через `#lib/address`, наружу отдаёт параметры.
 */
export { default as DemoPanel } from './DemoPanel.svelte'
export { default as CookieVault } from './CookieVault.svelte'
export {
  defineDemoPanel,
  demoDivider,
  demoPanelDefects,
  demoSelect,
  demoText,
  demoToggle,
  validateDemoPanel,
} from './define.js'
export type {
  DemoSchemaData,
  DemoDivider,
  DemoField,
  DemoFieldSpec,
  DemoOption,
  DemoPanelSchema,
  DemoSelectField,
  DemoTextField,
  DemoToggleField,
  DemoUrlPolicy,
  DemoValue,
  DemoValues,
  DemoVaultTrigger,
} from './types.js'
export { demoFieldSpec, demoFieldUi } from './ui.js'
export type { DemoFieldUi, DemoUiProps } from './ui.js'
export {
  demoDefaults,
  demoFields,
  demoForm,
  demoHref,
  demoParams,
  demoScenarioChange,
  demoUrlKey,
} from './schema.js'
