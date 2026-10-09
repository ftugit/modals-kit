// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { DataContext, Database } from '$lib/db'

declare global {
	namespace App {
		/**
		 * Навешивает `$lib/db/sveltekit` → `dbHandle`. Типы здесь, а не в
		 * хуке: `locals.db` должен быть типизирован во всех +page.server.ts, иначе
		 * «доверенный контекст» превращается в `any`.
		 */
		interface Locals {
			db: Database
			dbCtx: DataContext
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
