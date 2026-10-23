# План и реестр исправлений UI/UX и архитектуры (9 пунктов)

Актуальный список проблем, корневых причин и реализованных глобальных решений (поверх базового коммита `6028207`).

---

## Сводная таблица

| № | Проблема | Где корень | Глобальное решение | Статус |
|---|---|---|---|---|
| 1 | Иконка закрытия модалки (`×`) пропадает позже затемнения | `src/lib/modals/svelte/{ModalHost.svelte,classes.ts}` | Синхронизировать фазовые атрибуты `data-starting-style` / `data-ending-style` и `duration-220` по `opacity` у `MODAL_CLOSE_CLASS` с `MODAL_BACKDROP_CLASS` | Готово |
| 2 | «Изменить профиль» (`stage=profile`) показывает экран «только для гостей» | `src/content/user/ui/{AuthModal.svelte,profile-form/ProfileForm.svelte}`, `src/content/user/index.ts` | Передавать нормализованный `entry.params.stage` из модального хоста в `AuthWidget` через общую `resolveAuthStep(stage)` и читать в `ProfileForm` живой профиль из `readUser` | Готово |
| 3 | Спиннер на номерах страниц пагинатора при скролле и клике | `src/lib/components/links/{link.svelte.ts,state.svelte.ts,modal-link.svelte.ts}`, `src/lib/components/paginator/{PageNav.svelte,PageLink.svelte,LoadingIndicator.svelte}` | Добавить глобальную опцию `indicator?: boolean \| 'click'` в `asLink` / `taskAttrs` / `useModalLink`; в `PageNav` / `PageLink` выключить спиннер по умолчанию (`indicator = false`); подключить `paginatorTask` и процент в опциональном аддоне `LoadingIndicator` | Готово |
| 4 | Смена разделов сайта не сбрасывает скролл | `src/lib/components/shell/{AppShell.svelte,CollapsingHeader.svelte}`, `src/lib/address/sveltekit.ts` | Сбрасывать `main[data-fe-scroll="owner"].scrollTop` при смене `pathname` (`afterNavigate`), сохраняя и восстанавливая позицию по истории на `popstate`, поддерживая `#hash` и не трогая query-навигации внутри страницы (`?page=`, `?modal=`, `?demo=`) | Готово |
| 5 | В `/fields` нажатие «+ поле» крутит спиннер на `Submit` формы | `src/lib/form/svelte/{field-set.svelte.ts,task.ts,bind.svelte.ts}`, формы в `src/content/user/ui/` | 1) В `fieldSet` с JS добавлять/удалять места локально без сетевого `POST` (`type="button"` после гидратации, нативный `POST` без JS сохранён). 2) Глобально в `formTask(state, intent = 'submit')` и `form.intent(id)` зажигать спиннер и `aria-busy` строго на кнопке своего намерения | Готово |
| 6 | Кнопка `×` на `Attachment` очищает `<input>`, но не убирает карточку `Attachment` (и в `/fields`, и у аватара) | `src/lib/components/ui/file-attachment/FileAttachment.svelte` | Хранить неизменяемый реактивный снимок `File[]` вместо мутируемого на месте DOM-объекта `FileList` (`Object.is(prev, next) === true` при `input.value = ''` в Blink) и синхронизировать `prevFiles = files` после вызова внешнего `onchange` | Готово |
| 7 | Выход из аккаунта не меняет статус авторизации без перезагрузки (`F5`) | `src/content/user/vault.svelte.ts`, `src/routes/(site)/+layout.svelte`, `src/content/user/ui/*.svelte` | Сделать RAM `vault` единственным источником правды на клиенте после инициализации (`readUser`), синхронизировать с `data.user` через `vault.syncServer` только при реальной смене серверного токена и убрать гонку `close()` + `goto('/')` в `MenuModal.svelte` | Готово |
| 8 | Стилизация `Acl` и передача классов/вариантов по цепочке в модалках и на роутах | `src/content/user/ui/{Acl,AuthWidget,AuthModal,BanNotice,RestrictionsNotice,MenuBody,MenuModal,profile-form/ProfileForm,seed-form/SeedForm}.svelte`, роуты `/user/{auth,menu}` | Прокинуть `class` (через `cn`) и `variant?: 'card' \| 'plain'` сквозь всю цепочку компонентов (`AuthWidget` → `Acl`, `BanNotice`, `RestrictionsNotice`, `ProfileForm`, `SeedForm`, а также `MenuBody`), применяя их на обоих уровнях — и на внешнем блоке `Acl`, и на внутреннем корневом блоке компонента | Готово |
| 9 | Отсутствуют левый и правый отступы у мобильного `<main>` | `src/lib/components/shell/AppShell.svelte`, `src/lib/components/header/SiteFooter.svelte`, `src/lib/components/ErrorPage.svelte`, `src/routes/(site)/**/+page.svelte` | Централизованно задать в `AppShell` симметричные отступы рабочей зоны `p-4` на мобильном (`sm:px-6 sm:py-10` на `sm+`), вынести `SiteFooter` в слот `footer` во всю ширину и убрать разрозненные внешние `py-*` со страниц | Готово |

---

## Детальный разбор каждого пункта

### 1. Иконка закрытия модалки пропадает позже затемнения
- **Причина:** `Dialog.Backdrop` (`MODAL_BACKDROP_CLASS`) анимирует `opacity` за `220ms` по атрибутам `data-starting-style` / `data-ending-style`, тогда как `<button data-modal-close>` (`MODAL_CLOSE_CLASS`) оставалась в DOM с `opacity: 1` вплоть до конца exit-анимации карточки (`280–320ms`) и исчезала скачком.
- **Решение:** прокинуты `data-starting-style` и `data-ending-style` на кнопку закрытия в `ModalHost.svelte` и добавлены переходы `transition-[opacity,background-color,color] duration-220 ease-[ease] motion-reduce:duration-[1ms] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0` в `MODAL_CLOSE_CLASS`.

### 2. «Изменить профиль» (`stage=profile`) показывает гостевой экран
- **Причина:** `MenuBody.svelte` открывает `asModalLink('user.auth', { stage: 'profile' }, { href: '/user/auth?stage=profile' })`, но `AuthModal.svelte` игнорировал `m.entry.params.stage` и отдавал `AuthWidget` ответ `preload('/user/auth')` со `step: 'auth.entry'`, из-за чего рендерился гостевой `SeedForm` (`<Acl allow="guest">`). Дополнительно в `ProfileForm.svelte` `initial ?? vault.profile` отдавал предпочтение старому `initial` из preload перед живым `vault.profile`.
- **Решение:** вынесена единая функция нормализации `resolveAuthStep(stage)` (общая для `+page.server.ts` и `AuthModal.svelte`), `entry.params.stage` проброшен в `AuthWidget`, а `ProfileForm.svelte` переведён на `readUser(initial ? { prof: initial } : null)`.

### 3. Отключение спиннера у отдельных ссылок и у листа страниц пагинатора
- **Причина:**
  1. В `#lib/components/links` (`asLink`, `taskAttrs`, `useModalLink`) не было опции управления показом спиннера — любая активная задача зажигала спиннер на элементе, даже если пользователь не кликал по этой ссылке (например, при скролле ленты пагинатора в режиме `accumulate`, когда грузится страница `2`, спиннер крутился на номере `2` в `PageNav`).
  2. Спиннер загрузки страницы у самого пагинатора (`LoadingIndicator`) — опциональный аддон и не должен принудительно навязываться всем пагинаторам.
- **Решение:**
  - В `LinkOptions` (`asLink`), `taskAttrs` и `useModalLink` добавлена опция `indicator?: boolean | 'click'` (`true` по умолчанию — показывать всегда во время задачи; `'click'` — показывать спиннер только если нажатие произошло на этом самом элементе; `false` — полностью отключить визуальный спиннер на элементе).
  - В `PageNav` и `PageLink` прокинут `indicator?: boolean | 'click'` со значением по умолчанию `false` (с сохранением флага клика при смене `<a>` → `<span aria-current="page">`).
  - Опциональный аддон `LoadingIndicator.svelte` подключён к `paginatorTask` и глобальному `trackTask` с выводом процента прогресса (`data-task-percent`).

### 4. Сброс скролла при смене страниц на сайте без конфликта с URL-адаптером пагинатора
- **Причина:** оболочка `AppShell.svelte` запирает окно (`h-screen overflow-clip`) и крутит `<main data-fe-scroll="owner">`. При переходах между разделами SvelteKit сбрасывал `window.scrollY` (который всегда `0`), оставляя `main.scrollTop` посередине страницы. Плюс в `CollapsingHeader.svelte` при резком переходе `scrollTop → 0` механика `consume` отбрасывала `scrollTop` обратно на высоту скрытой шапки.
- **Решение:**
  - В `AppShell.svelte` подключены `beforeNavigate` / `afterNavigate`: сохраняется `main.scrollTop` по ключу записи истории, при смене маршрута (`from.url.pathname !== to.url.pathname`) позиция восстанавливается на `popstate`, переходит к `#hash` или сбрасывается в `main.scrollTop = 0`.
  - Навигации внутри того же `pathname` (`?page=2`, `?page.after=…`, `?modal=…`, `?demo=…`) не затрагиваются — URL-адаптер пагинатора и модальные слои сохраняют прокрутку.
  - В `CollapsingHeader.svelte` и `#lib/address/sveltekit.ts` корректно обработаны сброс `scrollTop = 0` и переходы по `#top` / `#hash` на `[data-fe-scroll="owner"]`.

### 5. Локальное добавление поля в `/fields` и строгая привязка спиннера к источнику события
- **Причина:**
  1. В `field-set.svelte.ts` после гидратации кнопки «+ поле» и «Удалить» оставались `type="submit"` и отправляли форму на сервер, хотя с JS место должно создаваться и удаляться локально на клиенте без сетевого запроса.
  2. Глобально `formTask(state)` без аргумента `intent` возвращал `pending` на любое намерение формы, из-за чего главная кнопка `Submit` крутила спиннер при любом чужом действии, а `form.intent(id)` вешал `aria-busy` на все кнопки сразу.
- **Решение:**
  1. В `field-set.svelte.ts` реализованы локальные `add()` и `remove(key)` (на тех же функциях ядра `blankFieldSetItem` / `fieldSetDraft`): после гидратации кнопки работают как `type="button"` мгновенно без общения с сервером; без JS сохраняется нативный `type="submit"` с серверным `fieldSetOp`.
  2. Глобально в `formTask(state, intent = 'submit')` по умолчанию слушается только `'submit'`, в `form.intent(id)` `aria-busy` выставляется только для `snapshot.pendingIntent === id`, а во всех формах с собственными `intent` передаётся точное имя намерения.

### 6. Отмена выбора файла кнопкой `×` на `Attachment`
- **Причина:** в `FileAttachment.svelte` в `$state` хранился живой DOM-объект `FileList`. При `inputEl.value = ''` движок Blink очищает тот же экземпляр `FileList` на месте (`Object.is(oldList, inputEl.files) === true`), поэтому сигнал Svelte 5 не инвалидировался и карточка `Attachment` оставалась на экране.
- **Решение:** в `$state` хранится свежий массив `File[]` (`Array.from(...)`), а `prevFiles = files` фиксируется сразу после вызова внешнего `onchange?.(e)`, что исключает как потерю реактивности при мутации живого `FileList` на месте, так и рассогласование `$state`-прокси или spread-атрибутов `{...attrs}` в `FileField`.

### 7. Мгновенное обновление статуса авторизации при выходе
- **Причина:**
  1. В `(site)/+layout.svelte` эффект после `vault.clear()` заново записывал старый SSR `data.user` обратно в `vault`.
  2. Компоненты `UserMenu`, `MenuBody`, `Acl`, `AuthWidget`, `ProfileForm` делали fallback на устаревший серверный `data.user`.
  3. `MenuModal.svelte` при выходе запускал одновременно `m.modals.close()` (`history.go(-1)`) и `goto('/')`.
- **Решение:** в `vault.svelte.ts` добавлены `vault.syncServer(payload)` (применяется на старте вкладки и только при реальной смене серверного токена) и единый читатель `readUser(server)` (SSR / до инициализации — `server`, на клиенте — реактивный RAM `vault`); гонка `goto('/')` в `MenuModal.svelte` устранена.

### 8. Проброс `class` (через `cn`) и `variant` по всей цепочке `AuthWidget` → `Acl` / блоки форм
- **Причина:** компоненты `Acl`, `AuthWidget`, `BanNotice`, `RestrictionsNotice`, `ProfileForm`, `SeedForm`, `MenuBody` не принимали `class` и `variant`, а `Acl` всегда жёстко рендерил карточку (`rounded-xl border bg-card p-4`).
- **Решение:**
  - Во все компоненты цепочки (`Acl`, `BanNotice`, `RestrictionsNotice`, `ProfileForm`, `SeedForm`, `MenuBody`, `AuthWidget`) добавлены пропсы `variant?: 'card' | 'plain'` (`userSurfaceVariants`) и `class?: string`.
  - Через `cn(...)` базовые стили `variant` и переданный `class` применяются одинаково и когда впереди рендерится сам блок `Acl`, и когда `Acl` пропускает управление внутреннему корневому блоку (`Form` / `div`).
  - В модалках (`AuthModal`, `MenuModal`) используется `variant="plain"`, на отдельных роутах (`/user/auth`, `/user/menu`) — `variant="card"`.

### 9. Отступы мобильного `<main>` (`4A`)
- **Причина:** страницы внутри `AppShell` задавали разрозненные `py-8` / `py-10` при `0px` боковых отступов, из-за чего на мобильном контент прилипал к краям экрана, а на коротких страницах `SiteFooter` висел посреди экрана.
- **Решение (`4A`):** в `AppShell.svelte` добавлен слот `footer`, основной контент обёрнут в `<div class="flex-1 p-4 sm:px-6 sm:py-10">` (`16px` со всех 4 сторон на `390×844`, `px-6 py-10` на `sm+`), `SiteFooter` растянут во всю ширину внизу, а дублирующие внешние `py-*` сняты со страниц.

---

## Верификация

- **Типы и шаблоны Svelte 5 (`npm run check`)**: `0 errors, 0 warnings`.
- **Модульные тесты и архитектурные стражи (`npm test`)**: `109/109` файлов Vitest (`1345/1345` тестов, включая новые регрессионные тесты `FileAttachment.svelte.test.ts`, `task.test.ts`, `vault.svelte.test.ts`) + `126/126` проверок `tooling/*.test.mjs` (`layer-guard`, `core-purity`, `classes-audit`, `form-size`, `db-docs`, `shikimori`, `load-url`).
- **Сборка продакшн-бандла (`npm run build`)**: чистая сборка клиента и сервера.
- **Браузерная приёмка в реальном Chromium (Playwright)**: `auth.mjs` (`27/27`), `shell.mjs` (`14/14`), `fields.mjs` (`46/46`), `loader.mjs` (`12/12`), `attachment.mjs` (`17/17`, `0` нарушений WCAG `axe-core` в светлой и тёмной темах), `modals.mjs` (`53/53`), `paginate.mjs` (`35/35`), `regressions.mjs`, `steps.mjs`, `forms.mjs`, `forms-a11y.mjs`, `db-demo.mjs`, `capabilities.mjs`, `errors.mjs` — **100% пройдены**.
