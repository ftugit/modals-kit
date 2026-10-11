// Неизвестный адрес → 404 ВНУТРИ каркаса. Без этого маршрута SvelteKit рисует
// 404 корневой границей ошибок, то есть только внутри корневого layout — без
// шапки и сайдбара (документированный приём: «404 pages», Advanced routing).
// Конкретные маршруты (`/api/*`, `/cycle`, `/spike`, страницы сайта) этот
// маршрут не перекрывают: rest-параметр сортируется последним.
import { error } from '@sveltejs/kit'
import type { PageLoad } from './$types'

export const load: PageLoad = () => {
  error(404, 'Not Found')
}
