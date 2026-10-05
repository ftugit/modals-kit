# TanStack Start Solid · lib form demo

Пустой TanStack Start Solid-проект, который использует ядро `../../src/lib/form` и Solid-адаптер из самой библиотеки: `@modals-kit/form/tanstack/solid`.

Файлы демо:

- `src/lib-form/shared.ts` — описание формы, свои валидаторы, свой тип `rating`, серверная проверка.
- `src/lib-form/server.ts` — `createServerFn` для повторной серверной проверки.
- `src/routes/index.tsx` — демо-страница на нативных HTML input/button.

CSS и UI-примитивы из основного SvelteKit-проекта не импортируются.

```bash
npm install
npm run dev
npm run build
npx tsc --noEmit
```
