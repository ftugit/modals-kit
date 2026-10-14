// Демо-функционал модалок одним импортом: панель настроек, панель
// источников, реестр определений, состояние источников и переиспользуемые
// виджеты. Роут /modals монтирует ровно эти экспорты — ничего копировать
// из страницы не нужно.
export { default as SettingsPanel } from './SettingsPanel.svelte'
export { default as SourcesPanel } from './SourcesPanel.svelte'
export { default as FloatingMenu } from './FloatingMenu.svelte'
export { demoScope } from './registry'
export { demoSources } from './sources.svelte'
