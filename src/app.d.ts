// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { DataContext, Database } from '#lib/db/index.js'

declare global {
	namespace App {
		/**
		 * Навешивает `#lib/db/sveltekit/index.js` → `dbHandle`. Типы здесь, а не в
		 * хуке: `locals.db` должен быть типизирован во всех +page.server.ts, иначе
		 * «доверенный контекст» превращается в `any`.
		 */
		interface Locals {
			db: Database
			dbCtx: DataContext
		}
		// interface Error {}
		// interface PageData {}
		/**
		 * Состояние записи истории (`pushState`/`replaceState`, `page.state`). Модалки хранят своё
		 * под ключом `modals` (`STATE_KEY`, `#lib/modals/build.ts`) и СЛИВАЮТ его с чужими ключами
		 * записи, а не затирают, — поэтому форма открытая: словарь, а не фиксированный набор полей.
		 */
		interface PageState {
			[key: string]: unknown
		}
		// interface Platform {}
	}
}

export {};
