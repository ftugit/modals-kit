# Реестр зачищенного устаревшего кода и хвостов (рефакторинг `user` / `Acl` / `hooks/component-form`)

Все зафиксированные ранее временные хвосты и устаревшие куски кода **полностью удалены**:

## Зачищено и закрыто

1. **Ручной `redirect(303)` гостей на `/user/menu`**:
   - Удалён из `src/routes/(site)/(app)/user/menu/+page.server.ts`: страница штатно отдаёт `user`, а гостевой доступ закрыт компонентом `<Acl allow="user">` внутри `MenuBody.svelte`.
2. **Мёртвый `demoFacts` и устаревшие комментарии прошлых ходов**:
   - Удалена неиспользуемая функция `demoFacts()` из `src/content/user/error.ts`, актуализированы комментарии в `src/content/user/config.ts` и `src/routes/(site)/(app)/user/auth/+page.server.ts`.
3. **Разрозненные файлы форм, сервера и аватара в корне `src/content/user/`**:
   - Удалены `src/content/user/{avatar.ts,avatar.test.ts,envelope.ts,field-mirror.svelte.ts,forms.ts,forms.test.ts,server-avatar.ts,server-avatar.test.ts,server-forms.ts}` и россыпь `src/content/user/ui/{SeedForm.svelte,SeedForm.svelte.test.ts,ProfileForm.svelte,ProfileForm.svelte.test.ts,AvatarTakeover.svelte}`.
   - Корень `src/content/user/` хранит только чистое доменное ядро (`auth.ts`, `profile.ts`, `acl.ts`, `checks.ts`, `config.ts`, `error.ts`, `gateway.ts`, `keys.ts`, `ports.ts`, `schema.ts`, `types.ts`, `vault.ts`, `vault.svelte.ts`), а составные UI-компоненты изолированы в своих папках (`src/content/user/ui/seed-form/` и `src/content/user/ui/profile-form/`).
4. **Серверный декодер изображений перенесён на своё место в `#lib/image`**:
   - Удалён `src/content/user/server-avatar.ts`; единая точка загрузки WASM-кодеков и декодирования в Node живёт в `src/lib/image/node.ts` (`decodeWithNode`, `ensureNodeImageCodecs`) и переиспользуется и серверным обработчиком `ui/profile-form/server.ts`, и тестами `src/lib/image/test-wasm.ts`.
5. **Браузерный набор `test/browser/auth.mjs` и черновые md-файлы**:
   - `test/browser/auth.mjs` переведён на новый контракт бинарного `File` аватара, компактного `FileAttachment`, экранов `Acl` (`guest_only`, `auth_required`) и серверного `decodeWithNode` в `no-JS`.
   - Удалены рабочие черновики `docs/design/{profile-form-fix.md,profile-and-hooks-qa.md}`; актуальное устройство отражено в `src/content/user/README.md` и `docs/plan.md`.
