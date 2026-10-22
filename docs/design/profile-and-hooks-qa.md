# План доработки модуля пользователя: UI ACL, декомпозиция шагов, фото-поле (`File`) и хук форм компонентов в `src/hooks`

Дата обновления: `2026-10-22`  
Статус: **НА УТВЕРЖДЕНИИ ВЛАДЕЛЬЦА — код приложения не изменяется до вашего «го»**.

---

## Часть I. Дословная фиксация прошлых замечаний владельца и краткие ответы

### Замечание 1 — Отправка `File`, а не `base64`-строки
> **Слова владельца:**  
> «1. Насколько я помню в обсуждении была сказано, что отправляться должен файл. Не строка. Сервер ожидает только файл и нечего кроме файла. Я не просто так уж валяюсь почему аватару не нужна загрузка, я просто не ожидал, что вы сделаете дыру где рандомный человек может загрузить что угодно в обход валидатора, достаточно простот base64 отправить.»

**Краткий ответ:**  
Подтверждено по `docs/design/image-transfer.md` (раздел *«Задача»*, строки 10–38, и этапы `R1–R3`): `avatar: field.hidden(...)` с `dataURL` — временный костыль старого коммита `7149ce8` под удаление. В `profileForm` поле обязано быть **`field.photo(...)` (`File | null`)** из `src/lib/components/form/photo.ts`, где и клиент, и сервер принимают **только `File`** и проверяют его заголовок через `check('photo:avatar')` (`probe` из `#lib/image`), а в строку БД результат сериализуется исключительно внутри серверного адаптера после прохождения валидатора.

### Замечание 2 — `no-JS` отправляет сырой `File`, с `JS` в то же поле кладётся сжатый `File`
> **Слова владельца:**  
> «2. Сырой файл отправляется при nojs, а при js в это поле устанавливается конвертированных у клиента. Ищи md где должно было упоминаться это.»

**Краткий ответ:**  
Проверено дословно в двух файлах:
- `docs/design/image-transfer.md` (*«Выбранный подход → Фронтенд»*, *«Staging-input вместо разных валидаторов»*): один именованный `<input type="file" name="avatar">` (`carrier`). При `no-JS` отправляется выбранный в него сырой `File` (`≤ 8 MiB`), который жмёт сервер (`R3`). При `JS` показывается staging-инпут без `name`, `#lib/image` сжимает картинку, собирает `new File([blob], 'avatar.jpg', { type: 'image/jpeg' })`, кладёт в `carrier` через `DataTransfer` и вызывает `f.onInput(file)`.
- `docs/design/steps-events-field-takeover.md` (*«B. Перехват поля»*): фиксирует тот же механизм через `Field takeover` (`DataTransfer` в carrier из `f.attrs` + `f.onInput`, удержание отправки через `f.pending`, локальные ошибки через `f.error`).

### Замечание 3 — Пропуск чтения `.md`
> **Слова владельца:**  
> «3. Прошлые пункты говорят, что файл должен быть, но md не читали.»

**Краткий ответ:**  
Признано. В этом ходе полностью, от первой до последней строки, вычитаны все профильные `.md` проекта и истории Git:
1. `docs/design/image-transfer.md` (702 строки — `R1–R7`, `field.photo`, staging + `DataTransfer`, серверный preparer `R3`, токен-очередь `R4`);
2. `docs/design/steps-events-field-takeover.md` (330 строк — хост шагов `auth` / `blocked` / `restrictions` / `profile`, куст `entry` / `register` / `restore`, `Field takeover`);
3. `docs/design/profile-form-fix.md` (43 строки);
4. `src/hooks/README.md` (24 строки — правила зоны `src/hooks/` для связок между `lib`);
5. `src/lib/components/steps/README.md` (468 строк — `useSteps`, `StepLink`, `formSteps`, цепочки ключей `auth.restore`);
6. `src/content/user/README.md` (98 строк — архитектура `content/user`, выключение при пустом `AUTH_SEAL_SECRET`, токены);
7. `docs/plan.md` (344 строки — все действующие решения владельца);
8. `src/lib/db/docs/ACL-DESIGN.md` (654 строки — модель субъектов `guest` / `user` / роли и fail-closed ACL);
9. `docs/design/auth-seed.md` из Git-истории (`git show 340db0c~1:docs/design/auth-seed.md`, 542 строки — исходное ТЗ по 3 таблицам, бану `scope: 'auth'`, частичным ограничениям `restrictions`, сессиям и софт-удалению).

### Замечание 4 — Без отдельных маршрутов `/user/profile`
> **Слова владельца:**  
> «4. Не нужно делать маршруты в целом. Валидация авторизации просто делается у компонента, совместо с 5 пунктом у step изменения профиля компонент позволит себя редактировать только юзерам, а авторизация читать себя нет.»

**Краткий ответ:**  
Зафиксировано и заложено в основу плана ниже. Отдельный маршрут `/user/profile` и `ProfileModal` удаляются, при этом проверенные рабочие куски кода из `5a30f8c` не выбрасываются, а переносятся в целевую структуру (`src/hooks/` + `src/content/user/ui/`).

### Замечание 5 — Почему связка оказалась в `lib`, а не в хуках
> **Слова владельца:**  
> «5. Это должен был быть вопрос, а я забыл вопросительный знак и теперь наблюдаю механизм который хрен знает как работает и почему то находится в lib. По сути это должен быть хук. Объясни как он работает.»

**Краткий ответ:**  
По `src/hooks/README.md` любые связки между независимыми ядрами `src/lib/*` и SvelteKit обязаны жить в **`src/hooks/`** (`#hooks/...`), а не внутри `src/lib/*`. Ниже в Этапе 1 описан перенос в `src/hooks/` и полное избавление от костыля flash-куки.

---

## Часть II. Новая постановка владельца (пункты 1–6) + сверка с `.md` и ответ по пункту 5 («что ещё забыто по аналогии»)

> **Постановка владельца:**
> 1. Необходимо авторизацию, регистрацию и восстановление аккаунта после удаления оформить в отдельный компонент. В этот компонент передается `view` чтобы отобразить нужный ui. Запретить компоненту отображаться для авторизованных и вместо него нужно отобрать новый `ui acl` в него передается отобразить `view` только для гостя.
> 2. Необходимо доработать компонент редактирования профиля. Для гостей отобрать `ui acl` в него передать отобразить `view` только для пользователя.
> 3. Компонент блокировка действий только для юзера.
> 4. Компонент бана только для гостя.
> 5. Что там я ещё забыл по аналогии.
> 6. Текущий хук который упаковал в `lib` нужно перенеси в хуки и без костылей пусть работает со всеми компонентами.

---

### Ответ на пункт 5: что ещё есть в модуле `user` по полной ревизии кода и `.md`

При сплошной проверке `src/content/user/**`, `src/routes/(site)/**`, `docs/design/auth-seed.md` и `docs/plan.md` найдены **два уже существующих в UI места** и **три готовых в серверном ядре (`auth.ts`), но ещё не имеющих UI блока**:

#### А. Уже есть в UI прямо сейчас — обязательно включить в эту же задачу по аналогии:
1. **`MenuBody.svelte` (меню аккаунта: модалка `?modal=user.menu` и страница `/user/menu`) → должен быть обёрнут в `UiAcl` (`allow="user"`):**
   - **Фактическая дыра сейчас:** в `src/content/user/ui/MenuModal.svelte` модалка открывается без серверного `route`. Если **гость** переходит по прямой ссылке `/?modal=user.menu`, ему прямо сейчас открывается окно с `?`, надписью «Без никнейма» и кнопками «Изменить профиль» / «Выйти»!
   - **Как станет с `UiAcl allow="user"` + хуком форм (п. 6):** `MenuBody.svelte` оборачивается в `UiAcl allow="user"` (гостю в модалке `/?modal=user.menu` и на `/user/menu` сразу показывается аккуратный экран `UiAcl` «только для пользователя», без ручных костылей), а кнопка «Выйти» внутри `MenuBody` работает через тот же общий хук форм компонентов (отдельная маленькая `logoutForm`), больше не привязываясь хардкодом `action="/user/auth"` к форме входа.
2. **Состояние выключенной подсистемы входа (`enabled === false`, когда не задан `AUTH_SEAL_SECRET`):**
   - Источник в `.md`: `src/content/user/README.md` (*«Выключение и env (конвенция хода 256): `AUTH_SEAL_SECRET` не задан → вход выключен, 500 не бывает: показывается баннер „Вход выключен“»*) и `docs/plan.md` (§5).
   - Это не гость/юзер, а выключенный на сервере модуль — баннер «Вход выключен» остаётся верхним guard-состоянием до проверки ролей, чтобы приложение никогда не падало с 500 без env-ключа.

#### Б. Уже реализовано в серверном ядре (`src/content/user/auth.ts` / `config.ts`), но UI-компонентов пока нет вовсе *(на ваше решение — делать сейчас или отдельным этапом)*:
3. **Заявка на мягкое удаление аккаунта (`requestDelete` в `src/content/user/auth.ts:390`, `auth-seed.md` §6 `Удаление`):**
   - Парадокс текущего состояния репо: экран **восстановления** удалённого аккаунта (`restore` в `AuthForm`, для **гостя**) уже есть, а кнопки/компонента **подать заявку на удаление аккаунта** (строго **`allow="user"`**, после чего сессия закрывается) в UI нигде нет — ни в `MenuBody`, ни отдельным шагом!
4. **Список активных устройств / сессий и отзыв (`listSessions`, `revokeSession(jti)`, `logoutAll` в `src/content/user/auth.ts:328–371`, `auth-seed.md` §6 `sessions`):**
   - В `auth.ts` полностью готово и покрыто `emulate.test.ts`, UI-компонента ещё нет (строго **`allow="user"`**).
5. **Настройка политики подсети сессии (`sessionRecreate: 'update' | 'strict'` в `src/content/user/config.ts`, `auth-seed.md` §8):**
   - В `config.ts` и `renew()` уже работает, UI-переключателя у юзера ещё нет (строго **`allow="user"`**; глобальные лимиты `TTL` / `nicknameForbidden` — для будущей роли `admin`).

---

### Ответ на вопрос про откат vs сохранение готового кода

**Делать слепой `git reset` и писать заново не нужно.**  
Правильный путь по Git:
- **Сохраняем и переносим** уже написанные и проверенные части из `f603a02` и `5a30f8c`:
  - компактное превью `FileAttachment` / `Attachment` и `Field takeover` (`f.pending` / `f.error`) в `ProfileForm.svelte`;
  - клиентскую адресную связку (`visibleAddress().url` → `pathname + search`) и серверный диспетчер по `__form_id` с пробросом `Set-Cookie` (`u.renew` куки сессии!) + юнит-тесты — переносим через `git mv` прямо в **`src/hooks/`** и упрощаем.
- **Чисто удаляем через `git rm`** только то, что не соответствует архитектуре:
  - `src/routes/(site)/(app)/user/profile/+page.server.ts` и `+page.svelte`;
  - `src/content/user/ui/ProfileModal.svelte` и `ProfileModalLazy.svelte` (+ запись `user.profile` в `auth-modals.ts`);
  - временные пути внутри `src/lib/` (`src/lib/server/component-forms*.ts`, `src/lib/components/form/route-form.svelte.ts`) после переноса в `src/hooks/`.

---

## Часть III. Детальный план реализации на утверждение

### Архитектура и матрица компонентов / прав

| Компонент | Где живёт | Входные пропсы | Правило `UiAcl` | Основание в `.md` / коде |
|---|---|---|---|---|
| **`UiAcl.svelte`** | `src/lib/components/acl/UiAcl.svelte` *(или `src/lib/components/ui/acl/UiAcl.svelte` — см. вопрос 1 внизу)* | `allow: 'guest' \| 'user'`, `authorized: boolean`, сниппет `children`, опционально `fallback` / действие перехода | Сам является UI-шлюзом доступа (fail-closed) | Постановка п. 1–4, `src/lib/db/docs/ACL-DESIGN.md` §1 (fail-closed, субъекты `guest` / `user`) |
| **`AuthForm.svelte`** | `src/content/user/ui/AuthForm.svelte` | `view: 'entry' \| 'register' \| 'restore'`, `limits`, `challenge`, `registerSeed`, `onSwitchView`, `onOutcome` | **`allow="guest"`** | Постановка п. 1, `docs/design/steps-events-field-takeover.md` §A (`entry`/`register`/`restore` на `authForm`) |
| **`ProfileForm.svelte`** | `src/content/user/ui/ProfileForm.svelte` | `limits`, `initial`, `doneHref`, `onDone` | **`allow="user"`** | Постановка п. 2, `docs/design/image-transfer.md` `R1–R3` (`field.photo` + `File`), `steps-events-field-takeover.md` §B |
| **`RestrictionsNotice.svelte`** | `src/content/user/ui/RestrictionsNotice.svelte` | `restrictions`, `doneHref`, `onDone` | **`allow="user"`** | Постановка п. 3, `auth.ts:127–130` (при частичных ограничениях сессия уже выдана → это `user`) |
| **`BanNotice.svelte`** | `src/content/user/ui/BanNotice.svelte` | `blocked: { reason: string; untilMs: number \| null }` | **`allow="guest"`** | Постановка п. 4, `auth.ts:119–122` (`fullBlock` не выдаёт сессию → субъект остаётся `guest`) |
| **`MenuBody.svelte`** | `src/content/user/ui/MenuBody.svelte` | `server`, `next`, `onDone` | **`allow="user"`** | Постановка п. 5, `docs/plan.md` §3 (`MenuModal` + `/user/menu` = один компонент) |
| **`AuthWidget.svelte`** | `src/content/user/ui/AuthWidget.svelte` | Тонкий координатор хоста `useSteps` (`owner: 'auth', key: 'stage'`) | Делегирует рендер шагам: `auth.*` → `<AuthForm view={...} />`, `blocked` → `<BanNotice />`, `restrictions` → `<RestrictionsNotice />`, `profile` → `<ProfileForm />` | `docs/design/steps-events-field-takeover.md` §A |

---

### Как работает переносной хук форм компонентов в `src/hooks/` (без единого костыля — пункт 6)

Размещается строго в **`src/hooks/`** по правилам `src/hooks/README.md` (соединяет `#lib/form` × `#lib/address` на клиенте и `#lib/form` × SvelteKit `Handle` на сервере; импорт через `#hooks/...`):

1. **`src/hooks/form-component.svelte.ts` — `useComponentForm(formsConfig, description, options)`**:
   - Читает реактивный текущий адрес страницы со всеми query-параметрами шага (`pathname + search`, например `/user/auth?stage=profile`) через `visibleAddress().url`.
   - Подхватывает `page.data.formResult`, если `formResult?.formId === description.id`.
   - Вызывает штатный `bind(formsConfig, description, { action: url, transport: kitActionTransport(url, options.transport), continuation })` — поэтому **работает и с кастомным `prepare` транспорта** (например, криптоподпись `nonce` по `seed` в `AuthForm`!).
2. **`src/hooks/form-component.server.ts` — `defineComponentForm(...)` + `componentFormsHandle` (`Handle` в `src/hooks.server.ts`)**:
   - Каждый доменный модуль регистрирует `{ description, checks?, limits?, execute, onNoJsSuccess? }` (никакой логики форм в `+page.server.ts` маршрутов больше не дублируется!).
   - На `POST`: если тело `urlencoded` или `multipart/form-data`, хук смотрит `__form_id`. Чужие `POST` сразу уходят в `resolve(event)` без накладных расходов.
   - Для зарегистрированной формы запускает штатный `createFormHandler` с `SECURITY_LAYERS`, `checks` и `limits`:
     - **JS (`Accept: application/json`):** сразу отвечает `Response.json({ data: { result } }, { status, headers })`, пробрасывая все `Set-Cookie`, выставленные внутри `execute` (вход, выход, ротация `u.renew`).
     - **no-JS успех (`result.ok === true`):** делает `redirect(303, onNoJsSuccess?.(event, result) ?? (pathname + search))` (чистый PRG).
     - **no-JS отказ (`result.ok === false` — ошибка валидации или отказ прав в `execute`):** **никаких flash-кук, никакого `localStore` и лишнего редиректа!** Хук просто кладёт `event.locals.formResult = result`, вызывает `await resolve(event)` в том же HTTP-запросе и возвращает HTML-ответ со статусом `status` (`400`/`403`/`422`) — ровно как делает нативный SvelteKit `fail()`. Повторное обновление `F5` или уход со страницы не оставляют вообще никакого серверного состояния или кук!
   - Через этот единый механизм работают **все** формы модуля `user`:
     - `authForm` (`AuthForm.svelte` — `login`, `restore`, `challenge`, `renew`);
     - `profileForm` (`ProfileForm.svelte` — `nickname` + `avatar: field.photo`);
     - `acceptRestrictionsForm` (`RestrictionsNotice.svelte` — подтверждение «Принято» с `JS` и `no-JS` одинаково!);
     - `logoutForm` (`MenuBody.svelte` — выход работает с любой страницы сайта и с `JS`, и без `JS`!).

---

### Поэтапный порядок работ и критерии приёмки (`<requirement_fidelity_gate>`)

| Этап | Что делаем | Наблюдаемое доказательство (гейт) |
|---|---|---|
| **Этап 1. Перенос хука форм в `src/hooks/` и уборка лишних маршрутов** | Переносим `component-forms` и `route-form` из `src/lib/*` в `src/hooks/form-component.server.ts` и `src/hooks/form-component.svelte.ts`; убираем flash-куку в пользу прямого `locals.formResult = result` + `resolve(event)` на `no-JS` ошибке; удаляем `/user/profile/+page.*` и `ProfileModal*`; обновляем `src/hooks/README.md`. | Юнит-тесты `src/hooks/form-component.server.test.ts` (`JS` + `Set-Cookie`, `no-JS` успех `303`, `no-JS` ошибка `422` через `resolve` без кук), `node --test tooling/*.test.mjs`, `npm run check`. |
| **Этап 2. UI ACL + декомпозиция `AuthForm`, `BanNotice`, `RestrictionsNotice`, `MenuBody`, `AuthWidget`** | Создаём `UiAcl.svelte` (`allow: 'guest' \| 'user'`, единый чистый view отказа доступа). Выносим `AuthForm.svelte` (проп `view: 'entry' \| 'register' \| 'restore'`, обёрнут в `UiAcl allow="guest"`), `BanNotice.svelte` (`UiAcl allow="guest"`), `RestrictionsNotice.svelte` (`UiAcl allow="user"`), оборачиваем `MenuBody.svelte` в `UiAcl allow="user"` + `logoutForm`. Возвращаем «Изменить профиль» в `MenuBody` на `?stage=profile` хоста `user.auth`. | Компонентные тесты Витеста для всех 5 комбинаций (`guest` vs `user` на `AuthForm`, `ProfileForm`, `RestrictionsNotice`, `BanNotice`, `MenuBody`): запрещённая сторона видит `UiAcl` и не видит форму/данные; разрешённая видит свой `view`. |
| **Этап 3. Доработка `ProfileForm` и серверного приёма `File` (`B+R2` + `R3`)** | Переводим `profileForm.fields.avatar` с `field.hidden` на **`field.photo`** (`File \| null`, `photoImage('avatar')`, `createUserChecks`). В `ProfileForm.svelte`: `UiAcl allow="user"` + именованный `carrier` (`no-JS` сырой `File` до `8 MiB`) + staging `FileAttachment` (`JS` сжатие через `#lib/image` → `new File(...)` в `carrier` через `DataTransfer` + `f.onInput` + `f.pending` / `f.error`). На сервере: preparer на `#lib/image` (проверка/сжатие сырого `File` в `data:image/jpeg;base64,...` внутри серверного адаптера), удаление строкового приёма `base64` извне. | Тесты: (1) отправка строки `base64` вместо `File` на сервер отвергается валидатором; (2) поддельный не-картиночный файл под видом `.jpg` отвергается `probe`; (3) сырой `File` (`no-JS`) сжимается на сервере в `200×200` `≤ 20 KiB` и сохраняется; (4) `JS` выбирает файл → кладёт сжатый `File` через `DataTransfer` в `carrier` → отправляет `File`; (5) полный прогон `npm run check`, `npm run test:classes`, `node --test tooling/*.test.mjs`, `npm run build`, `npm run test:size` + живой HTTP smoke (с `JS` и `no-JS`). |

---

## PROCEDURE и вопросы для утверждения плана владельцем

### Текущее состояние VCS (`<hard_rules>`)
- Репозиторий: `/home/user/projects/modals-kit`, ветка `img`, рабочее дерево чистое (изменён только этот файл плана `docs/design/profile-and-hooks-qa.md`, закоммичен локально, **без `git push`**).
- Все патчи сохранены в `/home/user/agent-state/patches/`.

### Пожалуйста, подтвердите перед стартом кода («го»):
1. **Место и вид `UiAcl.svelte`:** кладём в `src/lib/components/acl/UiAcl.svelte` (или `src/lib/components/ui/acl/UiAcl.svelte`)? На отказ доступа показываем спокойный встроенный блок с причиной («Доступно только гостям» / «Доступно только авторизованным пользователям») и кнопкой перехода («На главную / Выйти» для авторизованного в гостевом блоке; «Войти» — ссылкой на шаг `auth.entry` — для гостя в пользовательском блоке) — верно?
2. **Пункт 5 («что ещё забыто»):**
   - Включаем в этот заход обёртку **`MenuBody.svelte` в `UiAcl allow="user"`** (закрывает гостевое открытие `/?modal=user.menu`) и сохранение баннера `enabled === false` при пустом `AUTH_SEAL_SECRET`?
   - Нужен ли **уже в этом заходе** UI для готовых серверных функций `requestDelete` (удаление аккаунта — `allow="user"`) и/или `listSessions` / `revokeSession` / `logoutAll` (сессии — `allow="user"`), или оставляем их отдельным следующим этапом?
3. **Устаревший шаг 8 в `test/browser/auth.mjs`:** раньше он заходил залогиненным на `/user/auth` и ждал кнопку «Выйти из аккаунта» прямо в форме входа — меняем это ожидание в тесте на показ `UiAcl` («доступно только гостю»), так как выход живёт в `MenuBody`?
