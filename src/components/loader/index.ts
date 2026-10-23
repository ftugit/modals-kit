// Глобальный лоадер: `<LoaderBar />` в корневом layout + `trackTask` для своих задач.
// Ссылки `asLink`/`asModalLink` и `Button` с `task` попадают сюда сами.
export { default as LoaderBar } from './LoaderBar.svelte'
export { loaderView, TASK_DELAY_MS, trackTask, type LoaderView } from '#hooks/loader.svelte.js'
