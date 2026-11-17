# Аудит путей в документации (md)

Сгенерировано: 2026-11-17T11:28:41.409Z
База сравнения git: `b3a2efe` → HEAD (`80ec512`).
Проект: `modals-kit/`.

## Метод

- Собраны все `*.md` в workspace (кроме `node_modules`, `.git`, sysroot, node22 docs).
- Извлечены токены путей (`src/...`, `#alias/...`, `tooling/...`, `scripts/...`, `sim/...`).
- Проверено существование в текущем дереве; для отсутствующих — поиск по basename и маппинг переименований из `git diff -M`.
- Алиасы `#...` сопоставлены с `package.json#imports` (`#lib/#hooks/#server` → `src/core/...`; `#components` устарел → `src/core/ui`; `#content` устарел → `src/modules`/`src/sections`).

## Сводка

- md-файлов просканировано: 60
- уникальных токенов путей: 567
- существуют в текущем дереве: 341
- **отсутствуют (устарели/битые): 220**

## Распределение устаревших ссылок по md-файлам (топ-25)

| Файл | Кол-во устаревших токенов |
|---|---:|
| `modals-kit/docs/plan-modules-core-sections.md` | 127 |
| `modals-kit/docs/plan-sessions-components.md` | 27 |
| `modals-kit/docs/archive.md` | 21 |
| `modals-kit/docs/review-modules-migration.md` | 10 |
| `modals-kit/docs/plan-filter-followup.md` | 9 |
| `modals-kit/docs/checklist-sessions.md` | 8 |
| `plan-sessions-review.md` | 7 |
| `modals-kit/docs/plan-storage.md` | 6 |
| `modals-kit/docs/plan-fixes-2026-11-15.md` | 5 |
| `modals-kit/docs/tmp-auth-login.md` | 5 |
| `modals-kit/docs/plan-queue.md` | 4 |
| `modals-kit/src/core/lib/db/README.md` | 4 |
| `modals-kit/src/core/lib/paginate/filters/README.md` | 4 |
| `modals-kit/docs/plan-sessions-current.md` | 3 |
| `modals-kit/docs/plan-system-context.md` | 3 |
| `modals-kit/src/core/lib/db/PORTING.md` | 3 |
| `modals-kit/docs/pending.md` | 2 |
| `modals-kit/docs/audit-next-steps.md` | 2 |
| `modals-kit/docs/plan-cron-app.md` | 2 |
| `modals-kit/src/core/lib/storage/README.md` | 2 |
| `modals-kit/src/core/ui/steps/README.md` | 2 |
| `modals-kit/docs/plan-sessions.md` | 1 |
| `modals-kit/src/core/lib/db/docs/LIVE-APPEND.md` | 1 |
| `modals-kit/src/core/lib/db/docs/TRANSPORTS.md` | 1 |
| `modals-kit/src/core/lib/db/docs/ACL-DESIGN.md` | 1 |

## Рекомендации

1. Обновить `AGENTS.md` и `README.md` (корень `modals-kit/`): они по-прежнему описывают слои `src/lib`, `src/hooks`, `src/components`, `src/content`, `src/server` и алиасы `#lib/#hooks/#components/#content/#server`. После миграции актуальны `src/core/*`, `src/modules/*`, `src/sections/*` и алиасы `#core/*`, `#modules/*`, `#sections/*` (`#lib/#hooks/#server` в `package.json` перенаправлены в `src/core/...`, а `#components/#content` удалены).
2. В `docs/plan-*` и `docs/review-modules-migration.md` пути со старыми именами заменить по таблице git rename (см. entries с «Git rename»). Большинство имеют однозначный маппинг.
3. В README пакетов (`src/core/*/README.md`) импортные спецификаторы вида `#core/lib/.../index.js` корректны как ESM-импорты (расширение `.js` указывает на `.ts`-исходник) и не требуют правки; отсутствующие — только те, где файл реально переехал/переименован (см. «Предполагаемый новый путь»).
4. Удалить или переписать ссылки на несуществующие каталоги `src/components/*`, `src/content/*`, `src/lib/*`, `src/hooks/*`, `src/server/*` в исторических планах (или пометить их как исторические).

## Отсутствующие пути (устаревшие ссылки в md)

### `#content/user/schema`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Предполагаемый новый путь: `src/modules/user/schema` (проверьте вручную)

### `#core/lib/db/rest`

- Встречается в: `modals-kit/src/core/lib/db/docs/ACL-DESIGN.md`

### `#modules/my-form.js`

- Встречается в: `modals-kit/src/core/ui/steps/README.md`

### `#modules/my-form.ts`

- Встречается в: `modals-kit/src/core/ui/steps/README.md`

### `#modules/user/base/server/gateway.server.js`

- Встречается в: `modals-kit/docs/review-modules-migration.md`

### `docs/ACL-DESIGN.md`

- Встречается в: `modals-kit/src/core/lib/db/README.md`, `modals-kit/src/core/lib/db/docs/TRANSPORTS.md`
- Кандидаты по basename: `src/core/lib/db/docs/ACL-DESIGN.md`

### `docs/checklist-theme-sessions.md`

- Встречается в: `modals-kit/docs/archive.md`

### `docs/db-lib.md`

- Встречается в: `modals-kit/src/core/lib/db/PORTING.md`

### `docs/LIVE-APPEND.md`

- Встречается в: `modals-kit/src/core/lib/db/README.md`
- Кандидаты по basename: `src/core/lib/db/docs/LIVE-APPEND.md`

### `docs/plan-audit-fixes.md`

- Встречается в: `modals-kit/docs/archive.md`, `modals-kit/docs/pending.md`

### `docs/PROBES-ENV.md`

- Встречается в: `modals-kit/src/core/lib/db/README.md`
- Кандидаты по basename: `src/core/lib/db/docs/PROBES-ENV.md`

### `docs/tmp-bind-form-stage.md`

- Встречается в: `modals-kit/docs/archive.md`

### `docs/tmp-listing-sidebar.md`

- Встречается в: `modals-kit/docs/archive.md`, `modals-kit/docs/checklist-sessions.md`

### `docs/tmp-page-merge.md`

- Встречается в: `modals-kit/docs/archive.md`

### `docs/TRANSPORTS.md`

- Встречается в: `modals-kit/src/core/lib/db/README.md`, `modals-kit/src/core/lib/db/docs/LIVE-APPEND.md`
- Кандидаты по basename: `src/core/lib/db/docs/TRANSPORTS.md`

### `src/components/db-schema`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/db-schema` (проверьте вручную)

### `src/components/demo`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/demo` (проверьте вручную)

### `src/components/ErrorPage.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/components/ErrorPage.svelte` → `src/core/ui/errors/ErrorPage.svelte`
- Кандидаты по basename: `src/core/ui/errors/ErrorPage.svelte`
- Предполагаемый новый путь: `src/core/ui/errors/ErrorPage.svelte` (проверьте вручную)

### `src/components/fields`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/fields` (проверьте вручную)

### `src/components/form`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/form` (проверьте вручную)

### `src/components/listing`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/listing` (проверьте вручную)

### `src/components/listing/Listing.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/components/listing/Listing.svelte` → `src/core/ui/listing/Listing.svelte`
- Кандидаты по basename: `src/core/ui/listing/Listing.svelte`
- Предполагаемый новый путь: `src/core/ui/listing/Listing.svelte` (проверьте вручную)

### `src/components/listing/ListingRow.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/components/listing/ListingRow.svelte` → `src/core/ui/listing/ListingRow.svelte`
- Кандидаты по basename: `src/core/ui/listing/ListingRow.svelte`
- Предполагаемый новый путь: `src/core/ui/listing/ListingRow.svelte` (проверьте вручную)

### `src/components/listing/ListingSidebarHost.test.svelte`

- Встречается в: `modals-kit/docs/archive.md`
- Git rename: `src/components/listing/ListingSidebarHost.test.svelte` → `src/core/ui/listing/ListingSidebarHost.test.svelte`
- Кандидаты по basename: `src/core/ui/listing/ListingSidebarHost.test.svelte`
- Предполагаемый новый путь: `src/core/ui/listing/ListingSidebarHost.test.svelte` (проверьте вручную)

### `src/components/listing/README.md`

- Встречается в: `modals-kit/docs/checklist-sessions.md`
- Git rename: `src/components/listing/README.md` → `src/core/ui/listing/README.md`
- Кандидаты по basename: `README.md`, `sim/react-router/README.md`, `src/core/hooks/README.md`, `src/core/hooks/links/README.md`, `src/core/hooks/storage-server-form/README.md`, `src/core/lib/address/README.md`, `src/core/lib/cache/README.md`, `src/core/lib/db/README.md`
- Предполагаемый новый путь: `src/core/ui/listing/README.md` (проверьте вручную)

### `src/components/listing/types.ts`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/components/listing/types.ts` → `src/core/ui/listing/types.ts`
- Кандидаты по basename: `src/core/hooks/component-form/types.ts`, `src/core/hooks/cookie-vault/types.ts`, `src/core/lib/cache/types.ts`, `src/core/lib/db/types.ts`, `src/core/lib/form/types.ts`, `src/core/lib/image/types.ts`, `src/core/lib/modals/types.ts`, `src/core/lib/paginate/search/types.ts`
- Предполагаемый новый путь: `src/core/ui/listing/types.ts` (проверьте вручную)

### `src/components/loader`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/loader` (проверьте вручную)

### `src/components/modals`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/modals` (проверьте вручную)

### `src/components/paginator`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/paginator` (проверьте вручную)

### `src/components/paginator/filters`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Предполагаемый новый путь: `src/core/ui/paginator/filters` (проверьте вручную)

### `src/components/paginator/filters/ActiveFilters.notice.svelte.test.ts`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Git rename: `src/components/paginator/filters/ActiveFilters.notice.svelte.test.ts` → `src/core/ui/paginator/filters/ActiveFilters.notice.svelte.test.ts`
- Кандидаты по basename: `src/core/ui/paginator/filters/ActiveFilters.notice.svelte.test.ts`
- Предполагаемый новый путь: `src/core/ui/paginator/filters/ActiveFilters.notice.svelte.test.ts` (проверьте вручную)

### `src/components/paginator/filters/ActiveFilters.notice.test.svelte`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Git rename: `src/components/paginator/filters/ActiveFilters.notice.test.svelte` → `src/core/ui/paginator/filters/ActiveFilters.notice.test.svelte`
- Кандидаты по basename: `src/core/ui/paginator/filters/ActiveFilters.notice.test.svelte`
- Предполагаемый новый путь: `src/core/ui/paginator/filters/ActiveFilters.notice.test.svelte` (проверьте вручную)

### `src/components/paginator/filters/ActiveFilters.svelte`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Git rename: `src/components/paginator/filters/ActiveFilters.svelte` → `src/core/ui/paginator/filters/ActiveFilters.svelte`
- Кандидаты по basename: `src/core/ui/paginator/filters/ActiveFilters.svelte`
- Предполагаемый новый путь: `src/core/ui/paginator/filters/ActiveFilters.svelte` (проверьте вручную)

### `src/components/paginator/filters/FilterBlockPopup.svelte`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Git rename: `src/components/paginator/filters/FilterBlockPopup.svelte` → `src/core/ui/paginator/filters/FilterBlockPopup.svelte`
- Кандидаты по basename: `src/core/ui/paginator/filters/FilterBlockPopup.svelte`
- Предполагаемый новый путь: `src/core/ui/paginator/filters/FilterBlockPopup.svelte` (проверьте вручную)

### `src/components/paginator/filters/FiltersPanel.svelte`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Git rename: `src/components/paginator/filters/FiltersPanel.svelte` → `src/core/ui/paginator/filters/FiltersPanel.svelte`
- Кандидаты по basename: `src/core/ui/paginator/filters/FiltersPanel.svelte`
- Предполагаемый новый путь: `src/core/ui/paginator/filters/FiltersPanel.svelte` (проверьте вручную)

### `src/components/settings`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/settings` (проверьте вручную)

### `src/components/shell`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/shell` (проверьте вручную)

### `src/components/shell/merge-slot.test.ts`

- Встречается в: `modals-kit/docs/archive.md`
- Git rename: `src/components/shell/merge-slot.test.ts` → `src/core/ui/shell/merge-slot.test.ts`
- Кандидаты по basename: `src/core/ui/shell/merge-slot.test.ts`
- Предполагаемый новый путь: `src/core/ui/shell/merge-slot.test.ts` (проверьте вручную)

### `src/components/shell/page.svelte.ts`

- Встречается в: `modals-kit/docs/archive.md`
- Git rename: `src/components/shell/page.svelte.ts` → `src/core/ui/shell/page.svelte.ts`
- Кандидаты по basename: `src/core/ui/shell/page.svelte.ts`
- Предполагаемый новый путь: `src/core/ui/shell/page.svelte.ts` (проверьте вручную)

### `src/components/shell/ui/header/ThemeToggleSlot.svelte`

- Встречается в: `modals-kit/docs/archive.md`
- Git rename: `src/components/shell/ui/header/ThemeToggleSlot.svelte` → `src/core/ui/shell/ui/header/ThemeToggleSlot.svelte`
- Кандидаты по basename: `src/core/ui/shell/ui/header/ThemeToggleSlot.svelte`
- Предполагаемый новый путь: `src/core/ui/shell/ui/header/ThemeToggleSlot.svelte` (проверьте вручную)

### `src/components/steps`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/steps` (проверьте вручную)

### `src/components/steps/PopupSteps.svelte`

- Встречается в: `modals-kit/docs/archive.md`
- Git rename: `src/components/steps/PopupSteps.svelte` → `src/core/ui/steps/PopupSteps.svelte`
- Кандидаты по basename: `src/core/ui/steps/PopupSteps.svelte`
- Предполагаемый новый путь: `src/core/ui/steps/PopupSteps.svelte` (проверьте вручную)

### `src/components/storage-servers/StorageServerForm.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/components/storage-servers/StorageServerForm.svelte` → `src/modules/storage-servers/ui/StorageServerForm.svelte`
- Кандидаты по basename: `src/modules/storage-servers/ui/StorageServerForm.svelte`
- Предполагаемый новый путь: `src/modules/storage-servers/ui/StorageServerForm.svelte` (проверьте вручную)

### `src/components/ui`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/ui/ui` (проверьте вручную)

### `src/components/ui/button/HoldButton.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/components/ui/button/HoldButton.svelte` → `src/core/ui/button/HoldButton.svelte`
- Кандидаты по basename: `src/core/ui/button/HoldButton.svelte`
- Предполагаемый новый путь: `src/core/ui/button/HoldButton.svelte` (проверьте вручную)

### `src/components/ui/surface/SurfaceBar.svelte`

- Встречается в: `modals-kit/docs/checklist-sessions.md`, `modals-kit/docs/plan-sessions-current.md`
- Git rename: `src/components/ui/surface/SurfaceBar.svelte` → `src/core/ui/surface/SurfaceBar.svelte`
- Кандидаты по basename: `src/core/ui/surface/SurfaceBar.svelte`
- Предполагаемый новый путь: `src/core/ui/surface/SurfaceBar.svelte` (проверьте вручную)

### `src/components/utils.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/components/utils.ts` → `src/core/ui/utils.ts`
- Кандидаты по basename: `src/core/ui/utils.ts`
- Предполагаемый новый путь: `src/core/ui/utils.ts` (проверьте вручную)

### `src/content/demo-catalog`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/demo-catalog` (проверьте вручную)

### `src/content/storage-servers`

- Встречается в: `modals-kit/docs/plan-storage.md`
- Предполагаемый новый путь: `src/modules/storage-servers` (проверьте вручную)

### `src/content/storage-servers/form.ts`

- Встречается в: `modals-kit/docs/archive.md`, `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/storage-servers/form.ts` → `src/modules/storage-servers/form.ts`
- Кандидаты по basename: `src/core/hooks/storage-server-form/form.ts`, `src/core/lib/paginate/filters/form.ts`, `src/modules/storage-servers/form.ts`, `src/modules/user/accounts/svelte/accounts-delete/form.ts`, `src/modules/user/base/svelte/auth/seed-form/form.ts`, `src/modules/user/base/svelte/logout/form.ts`, `src/modules/user/base/svelte/session-delete/form.ts`, `src/modules/user/base/svelte/user-config/form.ts`
- Предполагаемый новый путь: `src/modules/storage-servers/form.ts` (проверьте вручную)

### `src/content/storage-servers/modals.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/storage-servers/modals.ts` → `src/modules/storage-servers/modals.ts`
- Кандидаты по basename: `src/modules/storage-servers/modals.ts`, `src/modules/user/accounts/modals.ts`, `src/modules/user/base/modals.ts`, `src/modules/user/blocks/modals.ts`, `src/modules/user/profile/modals.ts`, `src/modules/user/sessions/modals.ts`
- Предполагаемый новый путь: `src/modules/storage-servers/modals.ts` (проверьте вручную)

### `src/content/storage-servers/routes.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/storage-servers/routes.ts` → `src/modules/storage-servers/routes.ts`
- Кандидаты по basename: `src/core/lib/address/routes.ts`, `src/core/lib/modals/cores/routes.ts`, `src/modules/storage-servers/routes.ts`, `src/modules/user/base/routes.ts`
- Предполагаемый новый путь: `src/modules/storage-servers/routes.ts` (проверьте вручную)

### `src/content/storage-servers/storage-server.form.server.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/storage-servers/storage-server.form.server.ts` → `src/modules/storage-servers/storage-server.form.server.ts`
- Кандидаты по basename: `src/modules/storage-servers/storage-server.form.server.ts`
- Предполагаемый новый путь: `src/modules/storage-servers/storage-server.form.server.ts` (проверьте вручную)

### `src/content/storage-servers/types.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/storage-servers/types.ts` → `src/core/lib/storage/pool-types.ts`
- Кандидаты по basename: `src/core/hooks/component-form/types.ts`, `src/core/hooks/cookie-vault/types.ts`, `src/core/lib/cache/types.ts`, `src/core/lib/db/types.ts`, `src/core/lib/form/types.ts`, `src/core/lib/image/types.ts`, `src/core/lib/modals/types.ts`, `src/core/lib/paginate/search/types.ts`
- Предполагаемый новый путь: `src/core/lib/storage/pool-types.ts` (проверьте вручную)

### `src/content/storage-servers/ui`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/storage-servers/ui` (проверьте вручную)

### `src/content/storage-servers/ui/StorageServersView.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/storage-servers/ui/StorageServersView.svelte` → `src/modules/storage-servers/ui/StorageServersView.svelte`
- Кандидаты по basename: `src/modules/storage-servers/ui/StorageServersView.svelte`
- Предполагаемый новый путь: `src/modules/storage-servers/ui/StorageServersView.svelte` (проверьте вручную)

### `src/content/storage-vault`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/storage-vault` (проверьте вручную)

### `src/content/storage-vault/schema.test.ts`

- Встречается в: `modals-kit/docs/archive.md`
- Кандидаты по basename: `src/core/ui/panel/schema.test.ts`, `src/modules/user/base/schema.test.ts`
- Предполагаемый новый путь: `src/modules/storage-vault/schema.test.ts` (проверьте вручную)

### `src/content/user`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-queue.md`, `modals-kit/docs/tmp-auth-login.md`
- Предполагаемый новый путь: `src/modules/user` (проверьте вручную)

### `src/content/user/accounts-admin.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/accounts-admin.ts` → `src/modules/user/accounts/service/accounts-admin.ts`
- Кандидаты по basename: `src/modules/user/accounts/service/accounts-admin.ts`
- Предполагаемый новый путь: `src/modules/user/accounts/service/accounts-admin.ts` (проверьте вручную)

### `src/content/user/accounts.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/accounts.ts` → `src/modules/user/accounts/service/accounts.ts`
- Кандидаты по basename: `src/modules/user/accounts/service/accounts.ts`
- Предполагаемый новый путь: `src/modules/user/accounts/service/accounts.ts` (проверьте вручную)

### `src/content/user/acl.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/acl.ts` → `src/modules/user/base/service/acl.ts`
- Кандидаты по basename: `src/core/lib/db/acl.ts`, `src/modules/user/base/service/acl.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/acl.ts` (проверьте вручную)

### `src/content/user/admin.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/admin.ts` → `src/modules/user/base/service/admin.ts`
- Кандидаты по basename: `src/core/lib/db/sync/admin.ts`, `src/modules/user/base/service/admin.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/admin.ts` (проверьте вручную)

### `src/content/user/auth.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`, `plan-sessions-review.md`
- Git rename: `src/content/user/auth.ts` → `src/modules/user/base/service/auth.ts`
- Кандидаты по basename: `src/modules/user/base/service/auth.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/auth.ts` (проверьте вручную)

### `src/content/user/blocks-admin.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/blocks-admin.ts` → `src/modules/user/blocks/service/blocks-admin.ts`
- Кандидаты по basename: `src/modules/user/blocks/service/blocks-admin.ts`
- Предполагаемый новый путь: `src/modules/user/blocks/service/blocks-admin.ts` (проверьте вручную)

### `src/content/user/blocks.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`, `modals-kit/docs/plan-system-context.md`
- Git rename: `src/content/user/blocks.ts` → `src/modules/user/base/service/blocks.ts`
- Кандидаты по basename: `src/modules/user/base/service/blocks.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/blocks.ts` (проверьте вручную)

### `src/content/user/bulk.ts`

- Встречается в: `modals-kit/docs/plan-fixes-2026-11-15.md`, `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/bulk.ts` → `src/modules/user/base/service/bulk.ts`
- Кандидаты по basename: `src/modules/user/base/service/bulk.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/bulk.ts` (проверьте вручную)

### `src/content/user/caps.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/caps.ts` → `src/modules/user/base/service/caps.ts`
- Кандидаты по basename: `src/modules/user/base/service/caps.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/caps.ts` (проверьте вручную)

### `src/content/user/checks.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/checks.ts` → `src/modules/user/profile/service/checks.ts`
- Кандидаты по basename: `src/modules/user/profile/service/checks.ts`
- Предполагаемый новый путь: `src/modules/user/profile/service/checks.ts` (проверьте вручную)

### `src/content/user/config-api.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/config-api.ts` → `src/modules/user/base/service/config-api.ts`
- Кандидаты по basename: `src/modules/user/base/service/config-api.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/config-api.ts` (проверьте вручную)

### `src/content/user/config-policy.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/config-policy.ts` (проверьте вручную)

### `src/content/user/config.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `plan-sessions-review.md`
- Git rename: `src/content/user/config.ts` → `src/modules/user/base/service/config.ts`
- Кандидаты по basename: `src/core/lib/form/svelte/config.ts`, `src/modules/user/base/service/config.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/config.ts` (проверьте вручную)

### `src/content/user/emulate.test.ts`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`, `plan-sessions-review.md`
- Git rename: `src/content/user/emulate.test.ts` → `src/modules/user/base/emulate.test.ts`
- Кандидаты по basename: `src/modules/user/base/emulate.test.ts`
- Предполагаемый новый путь: `src/modules/user/base/emulate.test.ts` (проверьте вручную)

### `src/content/user/error.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/error.ts` → `src/core/auth/errors.ts`
- Кандидаты по basename: `src/modules/user/base/model/error.ts`
- Предполагаемый новый путь: `src/core/auth/errors.ts` (проверьте вручную)

### `src/content/user/gateway.server.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`, `modals-kit/docs/plan-system-context.md`
- Git rename: `src/content/user/gateway.server.ts` → `src/modules/user/base/service/gateway.server.ts`
- Кандидаты по basename: `src/modules/user/accounts/service/gateway.server.ts`, `src/modules/user/base/service/gateway.server.ts`, `src/modules/user/blocks/service/gateway.server.ts`, `src/modules/user/profile/service/gateway.server.ts`, `src/modules/user/sessions/service/gateway.server.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/gateway.server.ts` (проверьте вручную)

### `src/content/user/grants.svelte.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/grants.svelte.ts` → `src/modules/user/base/svelte/grants.svelte.ts`
- Кандидаты по basename: `src/modules/user/base/svelte/grants.svelte.ts`
- Предполагаемый новый путь: `src/modules/user/base/svelte/grants.svelte.ts` (проверьте вручную)

### `src/content/user/index.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/index.ts` → `src/modules/user/base/index.ts`
- Кандидаты по basename: `src/core/hooks/component-form/index.ts`, `src/core/hooks/cookie-vault/index.ts`, `src/core/hooks/links/index.ts`, `src/core/hooks/storage-server-form/index.ts`, `src/core/i18n/index.ts`, `src/core/lib/address/index.ts`, `src/core/lib/cache/index.ts`, `src/core/lib/db/index.ts`
- Предполагаемый новый путь: `src/modules/user/base/index.ts` (проверьте вручную)

### `src/content/user/keys.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/keys.ts` → `src/modules/user/base/service/keys.ts`
- Кандидаты по basename: `src/core/lib/address/keys.ts`, `src/core/ui/steps/keys.ts`, `src/modules/user/base/service/keys.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/keys.ts` (проверьте вручную)

### `src/content/user/messages.ts`

- Встречается в: `modals-kit/docs/archive.md`, `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/messages.ts` → `src/modules/user/base/messages.ts`
- Кандидаты по basename: `src/core/lib/form/messages.ts`, `src/modules/user/base/messages.ts`
- Предполагаемый новый путь: `src/modules/user/base/messages.ts` (проверьте вручную)

### `src/content/user/modals.ts`

- Встречается в: `modals-kit/docs/archive.md`, `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`
- Кандидаты по basename: `src/modules/storage-servers/modals.ts`, `src/modules/user/accounts/modals.ts`, `src/modules/user/base/modals.ts`, `src/modules/user/blocks/modals.ts`, `src/modules/user/profile/modals.ts`, `src/modules/user/sessions/modals.ts`
- Предполагаемый новый путь: `src/modules/user/modals.ts` (проверьте вручную)

### `src/content/user/permissions.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/permissions.ts` → `src/modules/user/base/service/permissions.ts`
- Кандидаты по basename: `src/modules/user/base/service/permissions.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/permissions.ts` (проверьте вручную)

### `src/content/user/ports.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ports.ts` → `src/modules/user/base/service/ports.ts`
- Кандидаты по basename: `src/modules/user/base/service/ports.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/ports.ts` (проверьте вручную)

### `src/content/user/probes/sessions-bulk.probe.mts`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Git rename: `src/content/user/probes/sessions-bulk.probe.mts` → `src/modules/user/base/probes/sessions-bulk.probe.mts`
- Кандидаты по basename: `src/modules/user/base/probes/sessions-bulk.probe.mts`
- Предполагаемый новый путь: `src/modules/user/base/probes/sessions-bulk.probe.mts` (проверьте вручную)

### `src/content/user/profile.ts`

- Встречается в: `modals-kit/docs/plan-fixes-2026-11-15.md`, `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-system-context.md`
- Git rename: `src/content/user/profile.ts` → `src/modules/user/profile/service/profile.ts`
- Кандидаты по basename: `src/modules/user/profile/service/profile.ts`
- Предполагаемый новый путь: `src/modules/user/profile/service/profile.ts` (проверьте вручную)

### `src/content/user/README.md`

- Встречается в: `modals-kit/docs/plan-sessions.md`, `plan-sessions-review.md`
- Git rename: `src/content/user/README.md` → `src/modules/user/base/README.md`
- Кандидаты по basename: `README.md`, `sim/react-router/README.md`, `src/core/hooks/README.md`, `src/core/hooks/links/README.md`, `src/core/hooks/storage-server-form/README.md`, `src/core/lib/address/README.md`, `src/core/lib/cache/README.md`, `src/core/lib/db/README.md`
- Предполагаемый новый путь: `src/modules/user/base/README.md` (проверьте вручную)

### `src/content/user/routes.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/routes.ts` → `src/modules/user/base/routes.ts`
- Кандидаты по basename: `src/core/lib/address/routes.ts`, `src/core/lib/modals/cores/routes.ts`, `src/modules/storage-servers/routes.ts`, `src/modules/user/base/routes.ts`
- Предполагаемый новый путь: `src/modules/user/base/routes.ts` (проверьте вручную)

### `src/content/user/schema.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`, `modals-kit/docs/review-modules-migration.md`, `plan-sessions-review.md`
- Git rename: `src/content/user/schema.ts` → `src/modules/user/base/model/schema.ts`
- Кандидаты по basename: `src/core/hooks/cookie-vault/schema.ts`, `src/core/lib/db/schema.ts`, `src/core/lib/form/schema.ts`, `src/core/lib/paginate/filters/schema.ts`, `src/core/ui/panel/schema.ts`, `src/modules/user/base/model/schema.ts`
- Предполагаемый новый путь: `src/modules/user/base/model/schema.ts` (проверьте вручную)

### `src/content/user/session-delete.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/session-delete.ts` → `src/modules/user/base/model/session-delete.ts`
- Кандидаты по basename: `src/modules/user/base/model/session-delete.ts`
- Предполагаемый новый путь: `src/modules/user/base/model/session-delete.ts` (проверьте вручную)

### `src/content/user/sessions`

- Встречается в: `modals-kit/docs/archive.md`
- Предполагаемый новый путь: `src/modules/user/sessions` (проверьте вручную)

### `src/content/user/sessions-exit.server.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/sessions-exit.server.ts` → `src/modules/user/sessions/service/sessions-exit.server.ts`
- Кандидаты по basename: `src/modules/user/sessions/service/sessions-exit.server.ts`
- Предполагаемый новый путь: `src/modules/user/sessions/service/sessions-exit.server.ts` (проверьте вручную)

### `src/content/user/sessions.form.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/sessions.form.ts` → `src/modules/user/sessions/svelte/sessions.form.ts`
- Кандидаты по basename: `src/modules/user/sessions/svelte/sessions.form.ts`
- Предполагаемый новый путь: `src/modules/user/sessions/svelte/sessions.form.ts` (проверьте вручную)

### `src/content/user/sessions.server.test.ts`

- Встречается в: `modals-kit/docs/tmp-auth-login.md`
- Git rename: `src/content/user/sessions.server.test.ts` → `src/modules/user/sessions/service/sessions.server.test.ts`
- Кандидаты по basename: `src/modules/user/sessions/service/sessions.server.test.ts`
- Предполагаемый новый путь: `src/modules/user/sessions/service/sessions.server.test.ts` (проверьте вручную)

### `src/content/user/sessions.server.ts`

- Встречается в: `modals-kit/docs/plan-fixes-2026-11-15.md`, `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/sessions.server.ts` → `src/modules/user/sessions/service/sessions.server.ts`
- Кандидаты по basename: `src/modules/user/sessions/service/sessions.server.ts`
- Предполагаемый новый путь: `src/modules/user/sessions/service/sessions.server.ts` (проверьте вручную)

### `src/content/user/spec-avatar.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/spec-avatar.ts` → `src/modules/user/profile/service/spec-avatar.ts`
- Кандидаты по basename: `src/modules/user/profile/service/spec-avatar.ts`
- Предполагаемый новый путь: `src/modules/user/profile/service/spec-avatar.ts` (проверьте вручную)

### `src/content/user/spec-block.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/spec-block.ts` → `src/modules/user/base/model/spec-block.ts`
- Кандидаты по basename: `src/modules/user/base/model/spec-block.ts`
- Предполагаемый новый путь: `src/modules/user/base/model/spec-block.ts` (проверьте вручную)

### `src/content/user/spec-config.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/spec-config.ts` → `src/modules/user/base/service/spec-config.ts`
- Кандидаты по basename: `src/modules/user/base/service/spec-config.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/spec-config.ts` (проверьте вручную)

### `src/content/user/spec-profile.test.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/spec-profile.test.ts` → `src/modules/user/base/spec-profile.test.ts`
- Кандидаты по basename: `src/modules/user/base/spec-profile.test.ts`
- Предполагаемый новый путь: `src/modules/user/base/spec-profile.test.ts` (проверьте вручную)

### `src/content/user/spec-profile.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/spec-profile.ts` → `src/modules/user/base/model/spec-profile.ts`
- Кандидаты по basename: `src/modules/user/base/model/spec-profile.ts`
- Предполагаемый новый путь: `src/modules/user/base/model/spec-profile.ts` (проверьте вручную)

### `src/content/user/types.ts`

- Встречается в: `modals-kit/docs/plan-fixes-2026-11-15.md`, `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`, `plan-sessions-review.md`
- Git rename: `src/content/user/types.ts` → `src/modules/user/base/model/types.ts`
- Кандидаты по basename: `src/core/hooks/component-form/types.ts`, `src/core/hooks/cookie-vault/types.ts`, `src/core/lib/cache/types.ts`, `src/core/lib/db/types.ts`, `src/core/lib/form/types.ts`, `src/core/lib/image/types.ts`, `src/core/lib/modals/types.ts`, `src/core/lib/paginate/search/types.ts`
- Предполагаемый новый путь: `src/modules/user/base/model/types.ts` (проверьте вручную)

### `src/content/user/ui`

- Встречается в: `modals-kit/docs/plan-sessions-current.md`
- Предполагаемый новый путь: `src/modules/user/ui` (проверьте вручную)

### `src/content/user/ui/accounts-delete`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/accounts-delete` (проверьте вручную)

### `src/content/user/ui/Acl.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/Acl.svelte` → `src/modules/user/base/svelte/Acl.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/Acl.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/Acl.svelte` (проверьте вручную)

### `src/content/user/ui/AuthModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/AuthModal.svelte` → `src/modules/user/base/svelte/AuthModal.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/AuthModal.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/AuthModal.svelte` (проверьте вручную)

### `src/content/user/ui/AuthWidget.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/AuthWidget.svelte` → `src/modules/user/base/svelte/AuthWidget.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/AuthWidget.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/AuthWidget.svelte` (проверьте вручную)

### `src/content/user/ui/BanNotice.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/BanNotice.svelte` → `src/modules/user/base/svelte/BanNotice.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/BanNotice.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/BanNotice.svelte` (проверьте вручную)

### `src/content/user/ui/Block`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/Block` (проверьте вручную)

### `src/content/user/ui/block-delete`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/block-delete` (проверьте вручную)

### `src/content/user/ui/block-form`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/block-form` (проверьте вручную)

### `src/content/user/ui/block-form/BlockFormBody.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/block-form/BlockFormBody.svelte` → `src/modules/user/blocks/svelte/block-form/BlockFormBody.svelte`
- Кандидаты по basename: `src/modules/user/blocks/svelte/block-form/BlockFormBody.svelte`
- Предполагаемый новый путь: `src/modules/user/blocks/svelte/block-form/BlockFormBody.svelte` (проверьте вручную)

### `src/content/user/ui/BlockCreateModal.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/BlockCreateModal.svelte` → `src/modules/user/blocks/svelte/BlockCreateModal.svelte`
- Кандидаты по basename: `src/modules/user/blocks/svelte/BlockCreateModal.svelte`
- Предполагаемый новый путь: `src/modules/user/blocks/svelte/BlockCreateModal.svelte` (проверьте вручную)

### `src/content/user/ui/Blocks`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/Blocks` (проверьте вручную)

### `src/content/user/ui/blocks-bulk`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/blocks-bulk` (проверьте вручную)

### `src/content/user/ui/blocks-list`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/blocks-list` (проверьте вручную)

### `src/content/user/ui/blocks-list/source.ts`

- Встречается в: `modals-kit/docs/checklist-sessions.md`
- Git rename: `src/content/user/ui/blocks-list/source.ts` → `src/modules/user/blocks/svelte/blocks-list/source.ts`
- Кандидаты по basename: `src/core/lib/form/source.ts`, `src/core/lib/paginate/source.ts`, `src/modules/user/accounts/svelte/seed-users/source.ts`, `src/modules/user/blocks/svelte/blocks-list/source.ts`, `src/modules/user/profile/svelte/profiles/source.ts`, `src/modules/user/sessions/svelte/sessions-list/source.ts`
- Предполагаемый новый путь: `src/modules/user/blocks/svelte/blocks-list/source.ts` (проверьте вручную)

### `src/content/user/ui/BlocksList.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/BlocksList.svelte` → `src/modules/user/blocks/svelte/BlocksList.svelte`
- Кандидаты по basename: `src/modules/user/blocks/svelte/BlocksList.svelte`
- Предполагаемый новый путь: `src/modules/user/blocks/svelte/BlocksList.svelte` (проверьте вручную)

### `src/content/user/ui/field-mirror.svelte.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/field-mirror.svelte.ts` → `src/modules/user/base/svelte/field-mirror.svelte.ts`
- Кандидаты по basename: `src/modules/user/base/svelte/field-mirror.svelte.ts`
- Предполагаемый новый путь: `src/modules/user/base/svelte/field-mirror.svelte.ts` (проверьте вручную)

### `src/content/user/ui/filter-messages.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/filter-messages.ts` → `src/modules/user/base/svelte/filter-messages.ts`
- Кандидаты по basename: `src/modules/user/base/svelte/filter-messages.ts`
- Предполагаемый новый путь: `src/modules/user/base/svelte/filter-messages.ts` (проверьте вручную)

### `src/content/user/ui/logout`

- Встречается в: `modals-kit/docs/plan-sessions-current.md`
- Предполагаемый новый путь: `src/modules/user/ui/logout` (проверьте вручную)

### `src/content/user/ui/logout/form.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/logout/form.ts` → `src/modules/user/base/svelte/logout/form.ts`
- Кандидаты по basename: `src/core/hooks/storage-server-form/form.ts`, `src/core/lib/paginate/filters/form.ts`, `src/modules/storage-servers/form.ts`, `src/modules/user/accounts/svelte/accounts-delete/form.ts`, `src/modules/user/base/svelte/auth/seed-form/form.ts`, `src/modules/user/base/svelte/logout/form.ts`, `src/modules/user/base/svelte/session-delete/form.ts`, `src/modules/user/base/svelte/user-config/form.ts`
- Предполагаемый новый путь: `src/modules/user/base/svelte/logout/form.ts` (проверьте вручную)

### `src/content/user/ui/logout/Logout`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/logout/Logout` (проверьте вручную)

### `src/content/user/ui/logout/Logout.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/logout/Logout.svelte` → `src/modules/user/base/svelte/logout/Logout.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/logout/Logout.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/logout/Logout.svelte` (проверьте вручную)

### `src/content/user/ui/LogoutModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/LogoutModal.svelte` → `src/modules/user/base/svelte/LogoutModal.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/LogoutModal.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/LogoutModal.svelte` (проверьте вручную)

### `src/content/user/ui/MenuBody.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/MenuBody.svelte` → `src/modules/user/base/svelte/MenuBody.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/MenuBody.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/MenuBody.svelte` (проверьте вручную)

### `src/content/user/ui/MenuModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/MenuModal.svelte` → `src/modules/user/base/svelte/MenuModal.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/MenuModal.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/MenuModal.svelte` (проверьте вручную)

### `src/content/user/ui/profile-delete`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/profile-delete` (проверьте вручную)

### `src/content/user/ui/profile-form`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/profile-form` (проверьте вручную)

### `src/content/user/ui/profile-form/spec-fit.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/profile-form/spec-fit.ts` → `src/modules/user/profile/service/spec-fit.ts`
- Кандидаты по basename: `src/modules/user/profile/service/spec-fit.ts`
- Предполагаемый новый путь: `src/modules/user/profile/service/spec-fit.ts` (проверьте вручную)

### `src/content/user/ui/Profile.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/Profile.svelte` → `src/modules/user/profile/svelte/Profile.svelte`
- Кандидаты по basename: `src/modules/user/profile/svelte/Profile.svelte`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/Profile.svelte` (проверьте вручную)

### `src/content/user/ui/ProfileCard.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/ProfileCard.svelte` → `src/modules/user/profile/svelte/ProfileCard.svelte`
- Кандидаты по basename: `src/modules/user/profile/svelte/ProfileCard.svelte`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/ProfileCard.svelte` (проверьте вручную)

### `src/content/user/ui/ProfileDeleteModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/ProfileDeleteModal.svelte` → `src/modules/user/profile/svelte/ProfileDeleteModal.svelte`
- Кандидаты по basename: `src/modules/user/profile/svelte/ProfileDeleteModal.svelte`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/ProfileDeleteModal.svelte` (проверьте вручную)

### `src/content/user/ui/ProfileEditModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/ProfileEditModal.svelte` → `src/modules/user/profile/svelte/ProfileEditModal.svelte`
- Кандидаты по basename: `src/modules/user/profile/svelte/ProfileEditModal.svelte`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/ProfileEditModal.svelte` (проверьте вручную)

### `src/content/user/ui/ProfileModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/ProfileModal.svelte` → `src/modules/user/profile/svelte/ProfileModal.svelte`
- Кандидаты по basename: `src/modules/user/profile/svelte/ProfileModal.svelte`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/ProfileModal.svelte` (проверьте вручную)

### `src/content/user/ui/ProfileModalLazy.svelte`

- Встречается в: `modals-kit/docs/archive.md`
- Предполагаемый новый путь: `src/modules/user/ui/ProfileModalLazy.svelte` (проверьте вручную)

### `src/content/user/ui/profiles/source.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/profiles/source.ts` → `src/modules/user/profile/svelte/profiles/source.ts`
- Кандидаты по basename: `src/core/lib/form/source.ts`, `src/core/lib/paginate/source.ts`, `src/modules/user/accounts/svelte/seed-users/source.ts`, `src/modules/user/blocks/svelte/blocks-list/source.ts`, `src/modules/user/profile/svelte/profiles/source.ts`, `src/modules/user/sessions/svelte/sessions-list/source.ts`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/profiles/source.ts` (проверьте вручную)

### `src/content/user/ui/ProfileScreen.svelte`

- Встречается в: `modals-kit/docs/archive.md`
- Предполагаемый новый путь: `src/modules/user/ui/ProfileScreen.svelte` (проверьте вручную)

### `src/content/user/ui/ProfilesList.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/ProfilesList.svelte` → `src/modules/user/profile/svelte/ProfilesList.svelte`
- Кандидаты по basename: `src/modules/user/profile/svelte/ProfilesList.svelte`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/ProfilesList.svelte` (проверьте вручную)

### `src/content/user/ui/ProfilesModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/ProfilesModal.svelte` → `src/modules/user/profile/svelte/ProfilesModal.svelte`
- Кандидаты по basename: `src/modules/user/profile/svelte/ProfilesModal.svelte`
- Предполагаемый новый путь: `src/modules/user/profile/svelte/ProfilesModal.svelte` (проверьте вручную)

### `src/content/user/ui/RestrictionsNotice.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/RestrictionsNotice.svelte` → `src/modules/user/base/svelte/RestrictionsNotice.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/RestrictionsNotice.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/RestrictionsNotice.svelte` (проверьте вручную)

### `src/content/user/ui/seed-form`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/seed-form` (проверьте вручную)

### `src/content/user/ui/seed-users`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/seed-users` (проверьте вручную)

### `src/content/user/ui/seed-users/source.ts`

- Встречается в: `modals-kit/docs/checklist-sessions.md`
- Git rename: `src/content/user/ui/seed-users/source.ts` → `src/modules/user/accounts/svelte/seed-users/source.ts`
- Кандидаты по basename: `src/core/lib/form/source.ts`, `src/core/lib/paginate/source.ts`, `src/modules/user/accounts/svelte/seed-users/source.ts`, `src/modules/user/blocks/svelte/blocks-list/source.ts`, `src/modules/user/profile/svelte/profiles/source.ts`, `src/modules/user/sessions/svelte/sessions-list/source.ts`
- Предполагаемый новый путь: `src/modules/user/accounts/svelte/seed-users/source.ts` (проверьте вручную)

### `src/content/user/ui/SeedUsers`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/SeedUsers` (проверьте вручную)

### `src/content/user/ui/SeedUsersEntry.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/SeedUsersEntry.svelte` → `src/modules/user/accounts/svelte/SeedUsersEntry.svelte`
- Кандидаты по basename: `src/modules/user/accounts/svelte/SeedUsersEntry.svelte`
- Предполагаемый новый путь: `src/modules/user/accounts/svelte/SeedUsersEntry.svelte` (проверьте вручную)

### `src/content/user/ui/Session`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/Session` (проверьте вручную)

### `src/content/user/ui/session-delete`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/session-delete` (проверьте вручную)

### `src/content/user/ui/session-delete/form.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/session-delete/form.ts` → `src/modules/user/base/svelte/session-delete/form.ts`
- Кандидаты по basename: `src/core/hooks/storage-server-form/form.ts`, `src/core/lib/paginate/filters/form.ts`, `src/modules/storage-servers/form.ts`, `src/modules/user/accounts/svelte/accounts-delete/form.ts`, `src/modules/user/base/svelte/auth/seed-form/form.ts`, `src/modules/user/base/svelte/logout/form.ts`, `src/modules/user/base/svelte/session-delete/form.ts`, `src/modules/user/base/svelte/user-config/form.ts`
- Предполагаемый новый путь: `src/modules/user/base/svelte/session-delete/form.ts` (проверьте вручную)

### `src/content/user/ui/session-delete/session-delete.form.server.ts`

- Встречается в: `modals-kit/docs/plan-fixes-2026-11-15.md`
- Git rename: `src/content/user/ui/session-delete/session-delete.form.server.ts` → `src/modules/user/sessions/service/session-delete.form.server.ts`
- Кандидаты по basename: `src/modules/user/sessions/service/session-delete.form.server.ts`
- Предполагаемый новый путь: `src/modules/user/sessions/service/session-delete.form.server.ts` (проверьте вручную)

### `src/content/user/ui/session-delete/SessionDelete.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/session-delete/SessionDelete.svelte` → `src/modules/user/base/svelte/session-delete/SessionDelete.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/session-delete/SessionDelete.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/session-delete/SessionDelete.svelte` (проверьте вручную)

### `src/content/user/ui/SessionCard.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/SessionCard.svelte` → `src/modules/user/sessions/svelte/SessionCard.svelte`
- Кандидаты по basename: `src/modules/user/sessions/svelte/SessionCard.svelte`
- Предполагаемый новый путь: `src/modules/user/sessions/svelte/SessionCard.svelte` (проверьте вручную)

### `src/content/user/ui/SessionDeleteModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/SessionDeleteModal.svelte` → `src/modules/user/sessions/svelte/SessionDeleteModal.svelte`
- Кандидаты по basename: `src/modules/user/sessions/svelte/SessionDeleteModal.svelte`
- Предполагаемый новый путь: `src/modules/user/sessions/svelte/SessionDeleteModal.svelte` (проверьте вручную)

### `src/content/user/ui/SessionModal.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/SessionModal.svelte` → `src/modules/user/sessions/svelte/SessionModal.svelte`
- Кандидаты по basename: `src/modules/user/sessions/svelte/SessionModal.svelte`
- Предполагаемый новый путь: `src/modules/user/sessions/svelte/SessionModal.svelte` (проверьте вручную)

### `src/content/user/ui/Sessions`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/Sessions` (проверьте вручную)

### `src/content/user/ui/sessions-list`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/sessions-list` (проверьте вручную)

### `src/content/user/ui/sessions-list/source.ts`

- Встречается в: `modals-kit/docs/checklist-sessions.md`
- Git rename: `src/content/user/ui/sessions-list/source.ts` → `src/modules/user/sessions/svelte/sessions-list/source.ts`
- Кандидаты по basename: `src/core/lib/form/source.ts`, `src/core/lib/paginate/source.ts`, `src/modules/user/accounts/svelte/seed-users/source.ts`, `src/modules/user/blocks/svelte/blocks-list/source.ts`, `src/modules/user/profile/svelte/profiles/source.ts`, `src/modules/user/sessions/svelte/sessions-list/source.ts`
- Предполагаемый новый путь: `src/modules/user/sessions/svelte/sessions-list/source.ts` (проверьте вручную)

### `src/content/user/ui/SessionsJournalModal.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/SessionsJournalModal.svelte` → `src/modules/user/sessions/svelte/SessionsJournalModal.svelte`
- Кандидаты по basename: `src/modules/user/sessions/svelte/SessionsJournalModal.svelte`
- Предполагаемый новый путь: `src/modules/user/sessions/svelte/SessionsJournalModal.svelte` (проверьте вручную)

### `src/content/user/ui/user-config`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/user-config` (проверьте вручную)

### `src/content/user/ui/user-picker-query.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/user-picker-query.ts` → `src/modules/user/accounts/svelte/user-picker-query.ts`
- Кандидаты по basename: `src/modules/user/accounts/svelte/user-picker-query.ts`
- Предполагаемый новый путь: `src/modules/user/accounts/svelte/user-picker-query.ts` (проверьте вручную)

### `src/content/user/ui/UserConfig.ssr.test.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/UserConfig.ssr.test.ts` → `src/modules/user/base/svelte/UserConfig.ssr.test.ts`
- Кандидаты по basename: `src/modules/user/base/svelte/UserConfig.ssr.test.ts`
- Предполагаемый новый путь: `src/modules/user/base/svelte/UserConfig.ssr.test.ts` (проверьте вручную)

### `src/content/user/ui/UserConfigModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/UserConfigModal.svelte` → `src/modules/user/base/svelte/UserConfigModal.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/UserConfigModal.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/UserConfigModal.svelte` (проверьте вручную)

### `src/content/user/ui/UserMenu.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/UserMenu.svelte` → `src/modules/user/base/svelte/UserMenu.svelte`
- Кандидаты по basename: `src/modules/user/base/svelte/UserMenu.svelte`
- Предполагаемый новый путь: `src/modules/user/base/svelte/UserMenu.svelte` (проверьте вручную)

### `src/content/user/ui/UserPicker`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/modules/user/ui/UserPicker` (проверьте вручную)

### `src/content/user/ui/UserPicker.svelte`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/ui/UserPicker.svelte` → `src/modules/user/accounts/svelte/UserPicker.svelte`
- Кандидаты по basename: `src/modules/user/accounts/svelte/UserPicker.svelte`
- Предполагаемый новый путь: `src/modules/user/accounts/svelte/UserPicker.svelte` (проверьте вручную)

### `src/content/user/ui/UsersDeleteModal.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/ui/UsersDeleteModal.svelte` → `src/modules/user/accounts/svelte/UsersDeleteModal.svelte`
- Кандидаты по basename: `src/modules/user/accounts/svelte/UsersDeleteModal.svelte`
- Предполагаемый новый путь: `src/modules/user/accounts/svelte/UsersDeleteModal.svelte` (проверьте вручную)

### `src/content/user/vault.svelte.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/content/user/vault.svelte.ts` → `src/modules/user/base/svelte/vault.svelte.ts`
- Кандидаты по basename: `src/modules/user/base/svelte/vault.svelte.ts`
- Предполагаемый новый путь: `src/modules/user/base/svelte/vault.svelte.ts` (проверьте вручную)

### `src/content/user/vault.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/content/user/vault.ts` → `src/modules/user/base/service/vault.ts`
- Кандидаты по basename: `src/modules/user/base/service/vault.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/vault.ts` (проверьте вручную)

### `src/core/i18n/messages.ru.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Кандидаты по basename: `src/core/ui/form/messages.ru.ts`

### `src/core/server/http/form-upload.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`

### `src/core/server/http/storage.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Кандидаты по basename: `src/core/lib/paginate/storage.ts`

### `src/core/server/security-hardening.test.ts`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Кандидаты по basename: `src/modules/user/base/tests/security-hardening.test.ts`

### `src/core/ui/access/Acl.svelte`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Кандидаты по basename: `src/modules/user/base/svelte/Acl.svelte`

### `src/core/ui/form/field-mirror.svelte.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Кандидаты по basename: `src/modules/user/base/svelte/field-mirror.svelte.ts`

### `src/core/ui/paginator/filter-messages.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Кандидаты по basename: `src/modules/user/base/svelte/filter-messages.ts`

### `src/hooks/component-form/registry.ts`

- Встречается в: `modals-kit/docs/plan-sessions-components.md`
- Git rename: `src/hooks/component-form/registry.ts` → `src/core/hooks/component-form/registry.ts`
- Кандидаты по basename: `src/core/hooks/component-form/registry.ts`, `src/core/lib/form/registry.ts`, `src/core/lib/image/registry.ts`, `src/core/lib/modals/registry.ts`, `src/core/lib/paginate/registry.ts`, `src/core/lib/paginate/search/registry.ts`
- Предполагаемый новый путь: `src/core/hooks/component-form/registry.ts` (проверьте вручную)

### `src/hooks/storage-db.test.ts`

- Встречается в: `modals-kit/docs/audit-next-steps.md`
- Git rename: `src/hooks/storage-db.test.ts` → `src/core/hooks/storage-db.test.ts`
- Кандидаты по basename: `src/core/hooks/storage-db.test.ts`
- Предполагаемый новый путь: `src/core/hooks/storage-db.test.ts` (проверьте вручную)

### `src/hooks/storage-db.ts`

- Встречается в: `modals-kit/docs/plan-storage.md`
- Git rename: `src/hooks/storage-db.ts` → `src/core/hooks/storage-db.ts`
- Кандидаты по basename: `src/core/hooks/storage-db.ts`
- Предполагаемый новый путь: `src/core/hooks/storage-db.ts` (проверьте вручную)

### `src/hooks/storage-schema.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-storage.md`
- Git rename: `src/hooks/storage-schema.ts` → `src/core/hooks/storage-schema.ts`
- Кандидаты по basename: `src/core/hooks/storage-schema.ts`
- Предполагаемый новый путь: `src/core/hooks/storage-schema.ts` (проверьте вручную)

### `src/hooks/storage-server-form`

- Встречается в: `modals-kit/docs/archive.md`, `modals-kit/docs/plan-modules-core-sections.md`
- Предполагаемый новый путь: `src/core/hooks/storage-server-form` (проверьте вручную)

### `src/lib/cron`

- Встречается в: `modals-kit/docs/plan-cron-app.md`, `modals-kit/docs/plan-sessions-components.md`, `plan-sessions-review.md`
- Предполагаемый новый путь: `src/core/lib/cron` (проверьте вручную)

### `src/lib/db`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Предполагаемый новый путь: `src/core/lib/db` (проверьте вручную)

### `src/lib/db/index.ts`

- Встречается в: `modals-kit/docs/archive.md`
- Git rename: `src/lib/db/index.ts` → `src/core/lib/db/index.ts`
- Кандидаты по basename: `src/core/hooks/component-form/index.ts`, `src/core/hooks/cookie-vault/index.ts`, `src/core/hooks/links/index.ts`, `src/core/hooks/storage-server-form/index.ts`, `src/core/i18n/index.ts`, `src/core/lib/address/index.ts`, `src/core/lib/cache/index.ts`, `src/core/lib/db/index.ts`
- Предполагаемый новый путь: `src/core/lib/db/index.ts` (проверьте вручную)

### `src/lib/db/policy.ts`

- Встречается в: `modals-kit/docs/archive.md`
- Git rename: `src/lib/db/policy.ts` → `src/core/lib/db/policy.ts`
- Кандидаты по basename: `src/core/lib/db/policy.ts`, `src/core/lib/form/policy.ts`
- Предполагаемый новый путь: `src/core/lib/db/policy.ts` (проверьте вручную)

### `src/lib/db/probes/pglite.probe.mts`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Git rename: `src/lib/db/probes/pglite.probe.mts` → `src/core/lib/db/probes/pglite.probe.mts`
- Кандидаты по basename: `src/core/lib/db/probes/pglite.probe.mts`
- Предполагаемый новый путь: `src/core/lib/db/probes/pglite.probe.mts` (проверьте вручную)

### `src/lib/db/test/db-grants.test.ts`

- Встречается в: `modals-kit/docs/archive.md`
- Кандидаты по basename: `src/core/hooks/db-grants.test.ts`
- Предполагаемый новый путь: `src/core/lib/db/test/db-grants.test.ts` (проверьте вручную)

### `src/lib/db/test/db-rules.test.ts`

- Встречается в: `modals-kit/docs/tmp-auth-login.md`
- Git rename: `src/lib/db/test/db-rules.test.ts` → `src/core/lib/db/test/db-rules.test.ts`
- Кандидаты по basename: `src/core/lib/db/test/db-rules.test.ts`
- Предполагаемый новый путь: `src/core/lib/db/test/db-rules.test.ts` (проверьте вручную)

### `src/lib/db/validation.ts`

- Встречается в: `modals-kit/docs/tmp-auth-login.md`
- Git rename: `src/lib/db/validation.ts` → `src/core/lib/db/validation.ts`
- Кандидаты по basename: `src/core/lib/db/validation.ts`
- Предполагаемый новый путь: `src/core/lib/db/validation.ts` (проверьте вручную)

### `src/lib/form/server.ts`

- Встречается в: `modals-kit/docs/tmp-auth-login.md`
- Git rename: `src/lib/form/server.ts` → `src/core/lib/form/server.ts`
- Кандидаты по basename: `src/core/lib/form/server.ts`
- Предполагаемый новый путь: `src/core/lib/form/server.ts` (проверьте вручную)

### `src/lib/paginate`

- Встречается в: `modals-kit/docs/checklist-sessions.md`
- Предполагаемый новый путь: `src/core/lib/paginate` (проверьте вручную)

### `src/lib/paginate/filters`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Предполагаемый новый путь: `src/core/lib/paginate/filters` (проверьте вручную)

### `src/lib/paginate/filters/group-patch.test.ts`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Git rename: `src/lib/paginate/filters/group-patch.test.ts` → `src/core/lib/paginate/filters/group-patch.test.ts`
- Кандидаты по basename: `src/core/lib/paginate/filters/group-patch.test.ts`
- Предполагаемый новый путь: `src/core/lib/paginate/filters/group-patch.test.ts` (проверьте вручную)

### `src/lib/paginate/filters/README.md`

- Встречается в: `modals-kit/docs/checklist-sessions.md`
- Git rename: `src/lib/paginate/filters/README.md` → `src/core/lib/paginate/filters/README.md`
- Кандидаты по basename: `README.md`, `sim/react-router/README.md`, `src/core/hooks/README.md`, `src/core/hooks/links/README.md`, `src/core/hooks/storage-server-form/README.md`, `src/core/lib/address/README.md`, `src/core/lib/cache/README.md`, `src/core/lib/db/README.md`
- Предполагаемый новый путь: `src/core/lib/paginate/filters/README.md` (проверьте вручную)

### `src/lib/paginate/filters/view.ts`

- Встречается в: `modals-kit/docs/plan-filter-followup.md`
- Git rename: `src/lib/paginate/filters/view.ts` → `src/core/lib/paginate/filters/view.ts`
- Кандидаты по basename: `src/core/lib/paginate/filters/view.ts`
- Предполагаемый новый путь: `src/core/lib/paginate/filters/view.ts` (проверьте вручную)

### `src/lib/queue`

- Встречается в: `modals-kit/docs/plan-queue.md`
- Предполагаемый новый путь: `src/core/lib/queue` (проверьте вручную)

### `src/lib/queue/README.md`

- Встречается в: `modals-kit/docs/plan-queue.md`
- Кандидаты по basename: `README.md`, `sim/react-router/README.md`, `src/core/hooks/README.md`, `src/core/hooks/links/README.md`, `src/core/hooks/storage-server-form/README.md`, `src/core/lib/address/README.md`, `src/core/lib/cache/README.md`, `src/core/lib/db/README.md`
- Предполагаемый новый путь: `src/core/lib/queue/README.md` (проверьте вручную)

### `src/lib/storage`

- Встречается в: `modals-kit/docs/plan-storage.md`
- Предполагаемый новый путь: `src/core/lib/storage` (проверьте вручную)

### `src/lib/storage/index.ts`

- Встречается в: `modals-kit/docs/plan-storage.md`
- Git rename: `src/lib/storage/index.ts` → `src/core/lib/storage/index.ts`
- Кандидаты по basename: `src/core/hooks/component-form/index.ts`, `src/core/hooks/cookie-vault/index.ts`, `src/core/hooks/links/index.ts`, `src/core/hooks/storage-server-form/index.ts`, `src/core/i18n/index.ts`, `src/core/lib/address/index.ts`, `src/core/lib/cache/index.ts`, `src/core/lib/db/index.ts`
- Предполагаемый новый путь: `src/core/lib/storage/index.ts` (проверьте вручную)

### `src/modules/demo/db.ext.ts`

- Встречается в: `modals-kit/docs/pending.md`

### `src/modules/demo/items/items.ts`

- Встречается в: `modals-kit/src/core/lib/paginate/README.md`

### `src/modules/demo/shikimori/filters.ts`

- Встречается в: `modals-kit/src/core/lib/paginate/filters/README.md`

### `src/modules/demo/shikimori/schema.server.test.ts`

- Встречается в: `modals-kit/src/core/lib/paginate/filters/README.md`

### `src/modules/demo/shikimori/ui/ShikimoriFilters.svelte`

- Встречается в: `modals-kit/src/core/lib/paginate/filters/README.md`

### `src/modules/demo/storage.server.ts`

- Встречается в: `modals-kit/src/core/lib/storage/README.md`

### `src/modules/storage-servers/server/form`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`

### `src/modules/user/accounts/server/accounts.ts`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Кандидаты по basename: `src/modules/user/accounts/service/accounts.ts`

### `src/modules/user/base/server`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`

### `src/modules/user/base/server/gateway.server.ts`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Кандидаты по basename: `src/modules/user/accounts/service/gateway.server.ts`, `src/modules/user/base/service/gateway.server.ts`, `src/modules/user/blocks/service/gateway.server.ts`, `src/modules/user/profile/service/gateway.server.ts`, `src/modules/user/sessions/service/gateway.server.ts`

### `src/modules/user/base/server/index.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Кандидаты по basename: `src/core/hooks/component-form/index.ts`, `src/core/hooks/cookie-vault/index.ts`, `src/core/hooks/links/index.ts`, `src/core/hooks/storage-server-form/index.ts`, `src/core/i18n/index.ts`, `src/core/lib/address/index.ts`, `src/core/lib/cache/index.ts`, `src/core/lib/db/index.ts`

### `src/routes/api/db-posts`

- Встречается в: `modals-kit/src/core/lib/db/PORTING.md`

### `src/routes/api/files`

- Встречается в: `modals-kit/src/core/lib/storage/README.md`

### `src/routes/api/shikimori/filters`

- Встречается в: `modals-kit/src/core/lib/paginate/filters/README.md`

### `src/server/actor.server.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/server/actor.server.ts` → `src/modules/user/base/service/actor.server.ts`
- Кандидаты по basename: `src/modules/user/base/service/actor.server.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/actor.server.ts` (проверьте вручную)

### `src/server/admin-bootstrap.server.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/server/admin-bootstrap.server.ts` → `src/modules/user/base/service/admin-bootstrap.server.ts`
- Кандидаты по basename: `src/modules/user/base/service/admin-bootstrap.server.ts`
- Предполагаемый новый путь: `src/modules/user/base/service/admin-bootstrap.server.ts` (проверьте вручную)

### `src/server/admin-bootstrap.test.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/server/admin-bootstrap.test.ts` → `src/modules/user/base/admin-bootstrap.test.ts`
- Кандидаты по basename: `src/modules/user/base/admin-bootstrap.test.ts`
- Предполагаемый новый путь: `src/modules/user/base/admin-bootstrap.test.ts` (проверьте вручную)

### `src/server/app-cron.server.ts`

- Встречается в: `modals-kit/docs/plan-cron-app.md`
- Предполагаемый новый путь: `src/core/server/app-cron.server.ts` (проверьте вручную)

### `src/server/app-storage.server.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`, `modals-kit/docs/plan-storage.md`
- Git rename: `src/server/app-storage.server.ts` → `src/core/server/app-storage.server.ts`
- Кандидаты по basename: `src/core/server/app-storage.server.ts`
- Предполагаемый новый путь: `src/core/server/app-storage.server.ts` (проверьте вручную)

### `src/server/app-storage.test.ts`

- Встречается в: `modals-kit/docs/audit-next-steps.md`
- Git rename: `src/server/app-storage.test.ts` → `src/core/server/app-storage.test.ts`
- Кандидаты по basename: `src/core/server/app-storage.test.ts`
- Предполагаемый новый путь: `src/core/server/app-storage.test.ts` (проверьте вручную)

### `src/server/photo-queue.server.ts`

- Встречается в: `modals-kit/docs/plan-queue.md`
- Предполагаемый новый путь: `src/core/server/photo-queue.server.ts` (проверьте вручную)

### `src/server/security-hardening.test.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/server/security-hardening.test.ts` → `src/modules/user/base/tests/security-hardening.test.ts`
- Кандидаты по basename: `src/modules/user/base/tests/security-hardening.test.ts`
- Предполагаемый новый путь: `src/modules/user/base/tests/security-hardening.test.ts` (проверьте вручную)

### `src/server/storage-probe.server.ts`

- Встречается в: `modals-kit/docs/plan-modules-core-sections.md`
- Git rename: `src/server/storage-probe.server.ts` → `src/core/server/storage-probe.server.ts`
- Кандидаты по basename: `src/core/server/storage-probe.server.ts`
- Предполагаемый новый путь: `src/core/server/storage-probe.server.ts` (проверьте вручную)

### `src/server/trusted-origins.ts`

- Встречается в: `modals-kit/docs/review-modules-migration.md`
- Git rename: `src/server/trusted-origins.ts` → `src/core/server/trusted-origins.ts`
- Кандидаты по basename: `src/core/server/trusted-origins.ts`
- Предполагаемый новый путь: `src/core/server/trusted-origins.ts` (проверьте вручную)

### `tooling/vite`

- Встречается в: `modals-kit/src/core/lib/db/PORTING.md`

## Устаревшие имена слоёв (алиасы без суффикса)

Эти токены — имена слоёв, а не файлы. В текущей архитектуре они переименованы:

- `#components` → #core/ui (старый алиас удалён из package.json)
- `#content` → #modules (и #sections для страниц)
- `#hooks` → #core/hooks
- `#modules` → актуален
- `#sections` → актуален
- `#server` → #core/server

## Существующие пути (кратко)

- `#content/demo`: 1 уникальных токенов
- `#content/storage-servers`: 1 уникальных токенов
- `#core/auth`: 1 уникальных токенов
- `#core/hooks`: 13 уникальных токенов
- `#core/lib`: 57 уникальных токенов
- `#core/server`: 4 уникальных токенов
- `#core/ui`: 20 уникальных токенов
- `#hooks/component-form`: 1 уникальных токенов
- `#lib/cache`: 1 уникальных токенов
- `#lib/db`: 1 уникальных токенов
- `#lib/image`: 1 уникальных токенов
- `#lib/storage`: 1 уникальных токенов
- `#modules`: 1 уникальных токенов
- `#modules/demo`: 1 уникальных токенов
- `#modules/user`: 5 уникальных токенов
- `docs/archive.md`: 1 уникальных токенов
- `docs/audit-next-steps.md`: 1 уникальных токенов
- `docs/checklist-sessions.md`: 1 уникальных токенов
- `docs/pending.md`: 1 уникальных токенов
- `docs/plan-cron-app.md`: 1 уникальных токенов
- `docs/plan-cron-worker.md`: 1 уникальных токенов
- `docs/plan-filter-followup.md`: 1 уникальных токенов
- `docs/plan-fixes-2026-11-15.md`: 1 уникальных токенов
- `docs/plan-queue.md`: 1 уникальных токенов
- `docs/plan-sessions-components.md`: 1 уникальных токенов
- `docs/plan-sessions-current.md`: 1 уникальных токенов
- `docs/plan-sessions.md`: 1 уникальных токенов
- `docs/plan-storage.md`: 1 уникальных токенов
- `docs/plan-system-context.md`: 1 уникальных токенов
- `docs/reverse-proxy-foreign-host.md`: 1 уникальных токенов
- `docs/trusted-edge-proxy.md`: 1 уникальных токенов
- `scripts/setup-playwright.sh`: 1 уникальных токенов
- `sim/react-router`: 1 уникальных токенов
- `src/composition`: 1 уникальных токенов
- `src/core`: 158 уникальных токенов
- `src/modules`: 27 уникальных токенов
- `src/routes`: 3 уникальных токенов
- `src/sections`: 2 уникальных токенов
- `tooling/ark-owns.mjs`: 1 уникальных токенов
- `tooling/classes-audit.mjs`: 1 уникальных токенов
- `tooling/core-purity.mjs`: 1 уникальных токенов
- `tooling/core-purity.test.mjs`: 1 уникальных токенов
- `tooling/db-docs.mjs`: 1 уникальных токенов
- `tooling/db-docs.test.mjs`: 1 уникальных токенов
- `tooling/form-size.mjs`: 1 уникальных токенов
- `tooling/journal-path-guard`: 1 уникальных токенов
- `tooling/journal-path-guard.mjs`: 1 уникальных токенов
- `tooling/layer-guard.mjs`: 1 уникальных токенов
- `tooling/layer-guard.test.mjs`: 1 уникальных токенов
- `tooling/mod.mjs`: 1 уникальных токенов
- `tooling/module-guard.mjs`: 1 уникальных токенов
- `tooling/module-registry.mjs`: 1 уникальных токенов
- `tooling/platform.mjs`: 1 уникальных токенов
- `tooling/public-api.mjs`: 1 уникальных токенов
- `tooling/public-api.test.mjs`: 1 уникальных токенов
- `tooling/session-delete-guard`: 1 уникальных токенов
- `tooling/sessions-dead-actions.test.mjs`: 1 уникальных токенов
- `tooling/size-budget.mjs`: 1 уникальных токенов
- `tooling/target-rule-guard.mjs`: 1 уникальных токенов
- `tooling/uno-probe.mjs`: 1 уникальных токенов
- `tooling/vitest-split.mjs`: 1 уникальных токенов
