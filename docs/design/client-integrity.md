# Целостность клиента: CSP, происхождение запросов и защита от чужого кода

Проектный документ по защите клиентского контура от XSS и несанкционированных сетевых вызовов. Содержит принятый разбор угроз, уже внедрённые механизмы и точный список того, что осталось включить в конфигурации SvelteKit (`kit.csp`).

---

## 1. Честная модель угроз

Клиентский код исполняется в браузере пользователя: DevTools, расширения браузера, прокси и прямые запросы к API через `curl` из клиента закрыть невозможно — любые инварианты данных, лимиты, права доступа (`guard`, политики `#lib/db`) и идемпотентность обеспечивает **сервер**.

Цель защиты клиентского контура ровно одна — **не дать постороннему скрипту исполниться в origin приложения (XSS) и не дать чужому origin отправлять запросы от имени сессии пользователя (CSRF)**.

---

## 2. Что уже работает в коде

1. **Проверка `Origin` на всех мутирующих запросах**:
   - `src/server/trusted-origins.ts` — единый расчёт доверенных origin (`KIT_TRUSTED_ORIGINS`, `PREVIEW_PORTS` и dev/preview-хосты), подключённый одновременно и в `sveltekit({ csrf: { trustedOrigins } })` (`vite.config.ts`), и в серверный `originLayer` библиотеки форм (`src/server/form-security.server.ts`).
2. **Куки сессии закрыты от чтения скриптом**:
   - `src/content/user/gateway.server.ts` хранит оба токена (`auth_sid`, `auth_tmp`) в `HttpOnly; SameSite=Lax`-куках; клиентский `vault` получает только вычисленный сервером срез данных. *(Доработка флага `Secure` для HTTPS — [`docs/pending.md`](../pending.md).)*
3. **Стилизация без динамических `<style>` в рантайме**:
   - UnoCSS (`unocss.config.ts`, `vite.config.ts`) компилирует все утилиты (включая `src/app.html` через `content.filesystem` и файлы с `/* @unocss-include */`) в статический CSS-бандл на этапе сборки; рантайм-инъекции CSS нет.
4. **Безопасный рендеринг шаблонов**:
   - В прикладных компонентах не используется `{@html …}` для пользовательских данных; строгие правила разметки и импортов контролирует `tooling/layer-guard.mjs`.
5. **Изоляция серверных обращений к внешним API**:
   - Внешние API (Shikimori, Rick & Morty) опрашиваются через серверные прокси-роуты `/api/shikimori/*` и `/api/rickmorty/*` поверх `#lib/fetch` (`src/server/fetch.server.ts`), так что браузер общается со своим `self` origin.

---

## 3. Что осталось включить: `kit.csp` в `vite.config.ts`

В `vite.config.ts` у `const kit = { ... }` блок **`csp` пока не включён**. При включении нужно учесть три реальные особенности текущей разметки проекта:

### 3.1. Ранний inline-скрипт темы в `src/app.html`
В `src/app.html` стоит синхронный `<script>` чтения `localStorage.getItem('fe-theme')` и `prefers-color-scheme` до первого кадра (защита от вспышки светлой темы).
- При включении `csp: { mode: 'auto', directives: { 'script-src': ['self'] } }` SvelteKit автоматически подписывает собственные скрипты гидратации nonce/hash-значениями, но **ручной `<script>` в `src/app.html` без nonce/hash будет заблокирован браузером**.
- **Решение при внедрении**: вынести список хэшей этого неизменяемого скрипта в `'script-src': ['self', 'sha256-…']` либо перенести ранний bootstrap в внешний блокирующий `/theme-init.js` с `'self'` и `immutable`-кэшем.

### 3.2. Внешние шрифты Google Fonts в `src/app.html`
Сейчас `src/app.html` подключает `Manrope` с `https://fonts.googleapis.com` и `https://fonts.gstatic.com`.
- Строгая директива `'style-src': ['self']` и `'font-src': ['self']` заблокирует внешнюю таблицу стилей и файлы шрифта.
- **Решение при внедрении (два варианта)**:
  1. *(Предпочтительный — self-host)* положить `Manrope` (`.woff2`) в `static/fonts/` и подключить из `src/app.css` — убирает внешнюю сетевую зависимость при первом рендере и позволяет оставить `style-src` / `font-src` строго на `'self'`;
  2. либо явно разрешить `'https://fonts.googleapis.com'` в `style-src` и `'https://fonts.gstatic.com'` в `font-src`.

### 3.3. Inline style attributes (`style="..."`) и превью изображений (`blob:` / `data:`)
- В `src/app.html` (`<div style="display: contents">`), в модальном хосте (`ModalHost.svelte` — позиционирование/размеры слоёв) и в прогресс-индикаторах (`Attachment`, `LoaderBar`) используются атрибуты `style="..."`. Поэтому в `style-src` при первом включении нужен `'unsafe-inline'` (либо раздельная политика `style-src-elem: ['self']`, `style-src-attr: ['unsafe-inline']` — поддерживается всеми целевыми браузерами CSP3 и запрещает инжекцию тегов `<style>`, разрешая только inline-атрибуты элементов!).
- Компонент `FileAttachment` создаёт превью через `URL.createObjectURL(file)` (`blob:`), а сохранённые превью аватаров и `/fields` используют `data:image/...`. Поэтому `img-src` обязан включать `'self'`, `'blob:'`, `'data:'` (плюс домены обложек демо-каталогов `'https:'`, пока картинки Shikimori/Rick&Morty грузятся напрямую в `<img src>`).

### 3.4. Целевая конфигурация `kit.csp` (готовая к проверке)

```ts
// vite.config.ts → const kit = { ... }
csp: {
  mode: 'auto',
  directives: {
    'default-src': ['self'],
    'script-src': ['self', 'sha256-<хэш inline-скрипта темы из src/app.html>'],
    'style-src-elem': ['self', 'https://fonts.googleapis.com'], // убрать googleapis после self-host шрифта
    'style-src-attr': ['unsafe-inline'],
    'font-src': ['self', 'https://fonts.gstatic.com'],          // убрать gstatic после self-host шрифта
    'img-src': ['self', 'data:', 'blob:', 'https:'],
    'connect-src': ['self'],
    'object-src': ['none'],
    'base-uri': ['self'],
    'form-action': ['self'],
    'frame-ancestors': ['none'], // для dev/preview в iframe песочницы ослаблять по env
  },
}
```

> **Важно для среды превью в iframe**: директива `'frame-ancestors': ['none']` заблокирует отображение приложения внутри iframe live-превью песочницы. В dev/preview (`!PROD` или при заданном `PREVIEW_PORTS`) `frame-ancestors` не выставляется либо ограничивается доверенными хостами, и включается строго на боевом окружении.
