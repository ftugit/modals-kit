// Ссылки приложения — не компоненты, а атрибуты на ваш собственный элемент:
//
//     <a {...asLink('/paginator')}>Пагинатор</a>
//     <Button {...asModalLink('card', { id: 7 })} variant="outline">Карточка</Button>
//
// Без JS это обычные `<a href>`. Вид состояния (спиннер, «!», %) рисует
// одно правило CSS (`indicator.ts`), подключённое в `unocss.config.ts`.
export { asLink, type LinkOptions } from './link.svelte.js'
export { useModalLink, type ModalLinkOptions } from './modal-link.svelte.js'
export { taskAttrs, type LinkAttrs } from './state.svelte.js'
