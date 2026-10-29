# Целостность клиента: CSP, происхождение запросов и защита от чужого кода

Проектный документ по защите клиентского контура от XSS и несанкционированных сетевых вызовов. Содержит принятый разбор угроз и действующую конфигурацию `kit.csp` и проверки `Origin`.

---

## 1. Честная модель угроз

Клиентский код исполняется в браузере пользователя: DevTools, расширения браузера, прокси и прямые запросы к API через `curl` из клиента закрыть невозможно — любые инварианты данных, лимиты, права доступа (`guard`, политики `#lib/db`) и идемпотентность обеспечивает **сервер**.

Цель защиты клиентского контура ровно одна — **не дать постороннему скрипту исполниться в origin приложения (XSS) и не дать чужому origin отправлять запросы от имени сессии пользователя (CSRF)**.

---

## 2. Действующие механизмы в коде

1. **Проверка `Origin` на всех мутирующих запросах**:
   - `src/server/trusted-origins.ts` — единый расчёт доверенных origin (`KIT_TRUSTED_ORIGINS`, `PREVIEW_PORTS` и dev/preview-хосты), подключённый одновременно и в `sveltekit({ csrf: { trustedOrigins } })` (`vite.config.ts`), и в серверный `originLayer` библиотеки форм (`src/server/form-security.server.ts`).
2. **Куки сессии закрыты от чтения скриптом**:
   - `src/content/user/gateway.server.ts` хранит оба токена (`auth_sid`, `auth_tmp`) в `HttpOnly; SameSite=Lax`-куках (`Secure` на HTTPS); клиентский `vault` получает только вычисленный сервером срез данных.
3. **Полный отказ от внешних шрифтов (Google Fonts)**:
   - В `src/app.html` и `unocss.config.ts` используется чистый системный стек (`ui-sans-serif, system-ui, sans-serif`) без сетевых обращений к `fonts.googleapis.com` и `fonts.gstatic.com`.
4. **Стилизация без динамических `<style>` в проде**:
   - UnoCSS (`unocss.config.ts`, `vite.config.ts`) компилирует все утилиты (включая `src/app.html` через `content.filesystem`) в статический CSS-бандл на этапе сборки.
5. **Безопасный рендеринг шаблонов и раздача загруженных файлов**:
   - В прикладных компонентах не используется `{@html …}` для пользовательских данных; строгие правила разметки и импортов контролирует `tooling/layer-guard.mjs`.
   - Раздача загруженных файлов (`/api/storage/*`, `/api/files/*`) отвечает отдельным изолирующим заголовком `Content-Security-Policy: default-src 'none'; sandbox` и `X-Content-Type-Options: nosniff`.
6. **Изоляция серверных обращений к внешним API**:
   - Внешние API (Shikimori, Rick & Morty) опрашиваются через серверные прокси-роуты `/api/shikimori/*` и `/api/rickmorty/*` поверх `#lib/fetch` (`src/server/fetch.server.ts`), так что браузер общается со своим `self` origin.

---

## 3. Конфигурация `kit.csp` (`src/server/trusted-origins.ts` → `vite.config.ts`)

`cspDirectives` собирается в чистом модуле `src/server/trusted-origins.ts` и подключается в `vite.config.ts` с `mode: 'auto'`:

- **`script-src`**: `['self', 'wasm-unsafe-eval', ...inlineScriptHashes]` — SvelteKit автоматически подписывает собственные скрипты гидратации `nonce`/`sha256`, `appHtmlScriptHashes` вычисляет актуальный `sha256-…` для раннего скрипта темы в `src/app.html`, а `'wasm-unsafe-eval'` разрешает браузерную компиляцию WebAssembly-кодеков `#lib/image` (`@jsquash/*`).
- **`style-src-elem` / `style-src-attr`**: `style-src-elem: ['self']` запрещает посторонние `<style>` и внешние таблицы стилей в продакшене (в `dev` сам SvelteKit добавляет `'unsafe-inline'` для HMR), а `style-src-attr: ['unsafe-inline']` разрешает реактивные `style:...` атрибуты компонентов.
- **`font-src`**: `['self', 'data:']` — никакие сторонние домены шрифтов не разрешены.
- **`img-src` / `media-src` / `worker-src` / `frame-src`**: покрывают `blob:`/`data:` превью кропа и вложений, а также обложки демо-каталогов по `https:`.
- **`connect-src`**: `['self']` в проде (покрывает `fetch` и same-origin WebSocket `/_ws/form-upload`) и `['self', 'ws:', 'wss:']` в `dev` (для Vite HMR).
- **`frame-ancestors`**: `['none']` в чистом боевом окружении; при `dev` или заданных переменных превью песочницы (`E2B_SANDBOX_ID`, `PREVIEW_PORTS`) опускается, чтобы live-preview работал во фрейме без блокировки.
