# Аудит и инструкция: `arch` — ядро, `drive` — устанавливаемый модуль

Редакция: 2026-11-17, после разбора неудачных Vercel-сборок.
Область: `modals-kit`. Документ заменяет предыдущую редакцию целиком.
**Статус: исследование и инструкция, не выполненная миграция.** В этом ходе
меняется только аудит; ветки, пакеты, код и деплои не изменяются.

## 1. Цель и границы

После выполнения инструкции:

- ветка `arch` содержит приложение-основу, библиотеки и общие механизмы
  подключения модулей; собирается без `demo` и без `drive`;
- ветка `module-drive` содержит устанавливаемый пакет `modules/drive/files/...`,
  а не вторую копию приложения с вшитым диском;
- `MODULES=none`, `demo`, `drive`, `demo,drive` — четыре допустимых состава;
- установка и снятие пакета не требуют редактировать файлы ядра;
- WebDAV-клиент, протокол и общий WebDAV-сервер остаются в `arch`;
  HTTP endpoint диска, адаптер БД, токены, UI, ссылки и маршруты приходят с `drive`.

Здесь «без модулей» означает без **опциональных пакетов demo/drive**.
Встроенный `user` и существующий `storage-servers` не удаляем. Превращение
всех пользовательских субмодулей в независимо снимаемые пакеты — не эта задача.
Не реализовывать `drive.ids`, новые операции диска и переписывание его домена.
Не расширять исключения `layer-guard` ради прохождения сборки.

## 2. Что установлено чтением исходников

| Место | Факт и следствие |
|---|---|
| `tooling/mod.mjs: readCatalogFromMap` | Читает **внешний** `modules/<name>/manifest.json`; payload — все файлы под `modules/<name>/files/`, путь после `files/` становится путём приложения. `install.targets` не используется. |
| `tooling/module-registry.mjs` | Читает **внутренние** `src/modules/**/manifest.json`; проверяет `entries`, пути `provides`, зависимости и циклы. Не устанавливает пакеты. |
| `tooling/mod.mjs: loadSourceMap` | Один `MODULES_SOURCE` или один `MODULES_REPO` + `MODULES_REF` на весь список модулей. `MODULES=demo,drive` не означает загрузку из двух одноимённых веток. |
| `tooling/mod.mjs: sync` | Если все записанные файлы существуют, пакет не обновляется даже при смене ref/версии; проверки SHA при этом нет. Установка и снятие в sync используют `force: true`. Это не доказательство безопасности совместной установки. |
| `src/core/app/nav.ts` | Теперь реестр с `extensions.push` и изменяемыми экспортируемыми массивами. |
| `src/routes/(site)/+layout.svelte` | Glob навигации и вызовы `registerNavExtension` находятся в instance-script, то есть повторяются при создании layout, в том числе на SSR. Сборка не обнаруживает накопление дубликатов. |
| `src/sections/home/HomePage.svelte` | Ручной импорт и рендер `DriveEntry`; удалить файлы drive без изменения этой связи нельзя. |
| `UserConfig.svelte` в `user/base/svelte/user-config` | Кроме реестра шагов, содержит `configStepOf('dav')`, `davMode`, `security.dav`, подпись WebDAV и отдельную ветку рендера. Это знание о drive в другом модуле. |
| `src/modules/drive/config.ext.ts` | Регистрирует только `{ id: 'dav', component }`; нынешнему контракту не хватает метаданных для общей навигации настроек. |
| `src/core/server/db.server.ts` | Собирает `db.ext.ts` и содержит существующие прямые зависимости на встроенный user/profile. Новую прямую зависимость на drive добавлять нельзя. |
| `src/hooks.server.ts` | Уже подхватывает `init.ext.server.ts` и `*.form.server.ts`; общие hooks не должны перечислять drive. |
| `tooling/module-guard.mjs` | Список payload берёт из фиксированного `refs/tags/modules`, fallback — локальное installed-state. Пакет из ветки `module-drive` может не попасть в проверку. |
| `.github/workflows/module-guard.yml` | Сейчас целевые ветки `img, main`, а не `arch`. |
| `.gitignore` | Есть список demo-путей, часть ещё по старым `src/server/...`; нет полного покрытия новых установочных путей. |

Demo нельзя оценивать по четырём файлам, оставшимся в `src/modules/demo`:
это не весь пакет. Установленный demo содержит `nav.ext.ts`, `db.ext.ts`,
`init.ext.server.ts`, модалки, страницы, API, тесты и другие payload-файлы.
Отсутствие внутреннего manifest у demo не означает, что он «не optional»:
для установки определяющим является внешний manifest в каталоге пакетов.

### 2.1. Что доказала история Vercel, а что нет

- `4f9caf4`: в коммит попал перенесённый `webdav/client.ts` со старыми
  относительными импортами (`./index.js` вместо `../index.js`). Локальная
  рабочая копия была исправлена, опубликованный снимок — нет.
- `6d25047`: импорты клиента исправлены, но endpoint `/api/dav` остался
  в ядре без `modules/drive`; сборка упала на отсутствующем импорте.
- `e5bd492`: после удаления endpoint из публикуемого ядра получен `READY`.
  Это подтверждает конкретный состав arch + demo, **не** установку drive,
  совместную работу двух пакетов или безопасность удаления.

Правило: собирать именно подготовленный снимок ядра + установленный пакет,
а не смешанное рабочее дерево с незакоммиченными зависимостями. Статус READY
и HTTP 200 не доказывают корректность SSR-реестров и всех функций приложения.

## 3. Владение файлами: точная граница

### Остаётся в `arch`

- `src/core/lib/storage/**`, включая `webdav.ts`, `webdav/client.ts`,
  `webdav/protocol.ts`, `webdav/server.ts`, их тесты, README и `entrypoints.json`.
- `src/core/lib/drive/**` — чистые функции имён, путей, дерева, квоты и курсора
  (сохраняем прежнее ограничение задачи). Никаких схем БД, UI и endpoint здесь.
- Общие storage-порты, ledger, дедупликация, реплики, `app-storage.server.ts`.
- Типы расширений, композиция навигации, общие хосты, установщик и его гарды.
- Обобщённая поддержка расширений настроек в user/base.

WebDAV остаётся библиотекой `Request → Response` с `DavBackend`/`DavLockStore`,
а не готовым маршрутом диска. `webdav.js` экспортирует client + protocol;
`webdav/server.js` — отдельный публичный серверный вход. Не возвращать
runtime-реэкспорт сервера в изоморфный barrel. Исправить противоречащие этому
комментарий «единая точка» и таблицы/пример импорта в storage README.
Перенесённый client использует `../index.js`, `../memory.js`,
`../stream-file.js`, `../types.js` — проверять именно отправляемые файлы.

### Весь этот набор принадлежит `drive`

| Установочный путь | Содержание |
|---|---|
| `src/modules/drive/**` | Схема и ACL, сервисы, WebDAV-адаптер и DB lock-store, токены, формы, UI, DTO, ключи/ссылки/маршруты, модалки, расширения, тесты, README и внутренний manifest |
| `src/sections/drive/**` | Load, actions, страницы и тесты; в том числе `dav-tokens.server.ts` |
| `src/routes/(site)/(app)/drive/**` | Все страницы и server-адаптеры, включая picker, trash, node и folder |
| `src/routes/(site)/(app)/user/config/dav/**` | Экран выдачи и отзыва паролей приложений |
| `src/routes/api/dav/[...path]/+server.ts` | Монтирование библиотеки на диск и его аутентификация |
| `tooling/drive-path-guard.mjs` | Доменный гард; перенести в пакет вместе с существующими проверками диска |

Включить относящиеся к диску планы `docs/plan-drive*.md`, если README модуля
сохраняет ссылки на них. Сам этот аудит разделения остаётся в arch.
Не включать `.env*`, installed-state, зависимости, build-output и секреты.
Не включать общие `HomePage`, layout, hooks, package.json или lockfile в payload:
модуль не должен перезаписывать файлы приложения.

Маршруты при установке физически появляются в `src/routes` — это нормально.
Запрещено не расположение, а **отслеживание этих файлов в исходном arch**.
SvelteKit обнаруживает их при sync/build; новый runtime-router не нужен.
Общий matcher `uuid` остаётся в ядре, дублировать его в пакете не требуется.

## 4. Исправления интеграции в arch до упаковки

### 4.1. Навигация: статическая композиция вместо накопительного реестра

1. В `src/composition/nav.ts` собрать eager-glob `/src/modules/**/nav.ext.ts`
   на уровне ES-модуля. Отсортировать ключи файлов, затем расширения по `order`.
2. В `core/app/nav.ts` оставить чистую сборку навигации из переданного массива
   `NavModuleExtension`: базовый пункт + вклады расширений. Экспорты результата
   readonly; убрать глобальные `extensions`, `push`, `splice` и регистрацию.
3. Composition вызывает эту сборку один раз и экспортирует `NAV_ITEMS`,
   `HOME_CARDS` и описанные ниже `HOME_ENTRIES`. Layout и HomePage импортируют
   **результат композиции**, а не регистрируют расширения при рендере.
   Можно использовать относительные импорты, не добавлять алиас ради двух файлов.
4. В `NavModuleExtension` добавить необязательный `homeEntries`:
   массив `{ id: string; component: Component }` (компонент без обязательных props).
   Контракт Svelte допустим в hooks, но не переносится в чистый core/lib.
   Проверять уникальность id; дубль — понятная ошибка, не тихое подавление.
5. HomePage рендерит элементы `HOME_ENTRIES` общим циклом внутри существующей
   сетки. Удалить только ручные импорт и `<DriveEntry />`. Встроенные user и
   storage-servers в этом ходе не мигрировать.
6. В payload `drive/nav.ext.ts` экспортировать `navExtension` с
   `homeEntries: [{ id: 'drive', component: DriveEntry }]`. Сохранить
   `vault.authorized` и `asModalLink('drive.browse')` внутри DriveEntry.
   Не заменять его публичной статической homeCard: это меняет видимость
   и поведение ссылки. Пункты меню сверх существующего UI не добавлять.

Demo продолжает отдавать прежние `homeCards`/`navItems` без обязательных изменений.
Ни одного glob/импорта модулей в core/app/nav, ни нового исключения в layer-guard.

### 4.2. Настройки: убрать знание о dav из user/base

Расширить существующий `ConfigStep` в `user-config/extensions.ts`, а не
добавлять второй реестр: метаданные `group`, `label`, `order?`, `ownOnly?`.
Для текущих встроенных расширений сохранить совместимые defaults (группа
security, label от id); поставщик sessions должен явно задать свою подпись.
Drive регистрирует `id: 'dav', group: 'security', label: 'WebDAV', ownOnly: true`.

В `UserConfig.svelte` получать список подходящих расширений из реестра,
рисовать ссылки циклом, выбирать активный компонент по group + id, а не
через `davMode`/`DavStep`. Сохранить вложенные адреса sessions, frame/header/body,
возврат к security, `onAcl`, url/local режимы и существующие проверки прав.
Не обходить ACL группы ради расширения. Неизвестный снятый шаг не должен
показывать мёртвую ссылку/пустой компонент: возврат к разрешённой группе.
После правки в user/base нет `dav`, `security.dav` и текста WebDAV.
Все специфичные ссылки `/user/config/dav` остаются внутри drive.

### 4.3. Серверная часть и WebDAV

- `drive/db.ext.ts` поставляет четыре ресурса и SQL-индексы. Без пакета их
  нет в schemaSpec; не добавлять drive в `db.server.ts` вручную.
- `config.ext.ts`, `modals.ts` подхватываются существующими общими glob.
- `/api/dav` поставляется только payload. В `+server.ts` экспортировать
  стандартные HTTP-методы и `fallback`; DAV-методы обрабатывает fallback.
  Не экспортировать `COPY`, `MOVE`, `PROPFIND`, `LOCK` и т. п. как named exports:
  SvelteKit отклоняет их при postbuild analysis.
- Общий сервер WebDAV остаётся в arch; `createDriveDav`, проверка токенов,
  `drive_dav_lock` и соединение с appStorage — в модуле.
- Снятие кода **не удаляет таблицы и файлы пользователя**. Не запускать reset,
  DROP или уборку storage при `mod remove`. Проверить политику schema-sync:
  отсутствие ресурса не должно превращаться в разрушительную миграцию.

### 4.4. Гарды без знаний о конкретном optional-пакете

- `drive-path-guard` уже обходит существующие src-файлы; его ALLOWED_FILES —
  только множество строк, он не читает отсутствующие drive-файлы напрямую.
  Прежняя рекомендация добавить existsSync была необоснованной. Перенести
  гард в пакет; запускать явно при проверке drive, не из обязательной команды arch.
- `sessions-dead-actions.test.mjs` тоже не читает DriveDavTokens напрямую:
  здесь проблема в доменном allowlist, а не ENOENT. Ограничить сессионное
  правило деревьями user/sessions и соответствующих sections; убрать drive
  из исключений. Проверку живого token revoke держать в тестах drive.
- `module-guard` должен читать объявленные источники payload (см. §5), а не
  узнавать drive только после установки или случайного обновления тега modules.
  В CI для arch добавить ветку arch; не отключать guard и не подавлять ошибки.
- Сверить .gitignore с реальным каталогом пакетов: игнорировать только точные
  пути установленных optional-файлов, не всё `src/modules`/`src/routes`.
  Guard обязан ловить и принудительно добавленные через `git add -f` файлы.



## 5. Сделать упаковку совместимой с двумя ветками

Текущий `tooling/mod.mjs` не умеет взять `drive` из отдельной ветки `module-drive` при
`MODULES=demo,drive`: один `MODULES_SOURCE`/`MODULES_REF` применяется ко всему
каталогу, а формат каталога ожидает один внешний `manifest.json` на пакет.
Нельзя делать вид, что текущий `mod.mjs` уже поддерживает два репозитория.

Для требуемых разных веток реализовать контракт **MODULES_REFS** ниже.
Один общий каталог описан только для объяснения ограничения, это не замена
решению владельца о ветках `arch` и `module-drive`.

### 5.1. Единственный сценарий веток

Один репозиторий `ftugit/modals-kit`:

- `refs/heads/arch` — основное приложение без optional payload;
- `refs/heads/module-drive` — пакет `modules/drive/manifest.json` и `modules/drive/files/**`;
- `refs/tags/modules` — существующий каталог demo (`modules/demo/**`).

Не переносить drive в общий тег modules и не создавать альтернативный каталог.
Для двух модулей loader получает два архива и выбирает из каждого только
соответствующий пакет. Ветка arch не является источником payload.

### 5.2. Один явный контракт — MODULES_REFS

Не вводить конкурирующую переменную MODULES_SOURCES. Использовать один
repo и JSON-переменную `MODULES_REFS`, например:

```bash
export MODULES_REPO='ftugit/modals-kit'
export MODULES_REF='refs/tags/modules'
export MODULES_REFS='{"demo":"refs/tags/modules","drive":"refs/heads/module-drive"}'
export MODULES='demo,drive'
unset MODULES_SOURCE
```

Это будущие настройки после реализации loader, а не инструкция запускать его
сейчас. Для воспроизводимых проверок зафиксировать commit OID каждого из этих
refs в отчёте и installed-state; повторное использование изменившейся ветки
не должно выдавать другой снимок под прежней идентичностью.

Для каждого выбранного имени брать указанный ref, иначе существующий
`MODULES_REF` (по умолчанию modules). Группировать загрузки по ref, принимать
из каталога только запрошенный пакет. MODULES_SOURCE сохраняет прежнюю семантику
единого локального каталога/архива — для офлайн-проверок он должен содержать
оба пакета. Не менять форму существующих MODULES/REPO/REF команд.

`MODULES_REFS` валидировать как объект допустимое имя пакета→непустая строка.
Полные refs/heads/* и refs/tags/* разрешать точно, не дописывать к ним повторно
refs/heads или refs/tags (нынешний loader перебирает эти префиксы).
Сначала разрешить ref в OID, затем скачивать archive по этому OID, исключив
гонку между чтением manifest и перемещением ref. Git-ref передавать в URL
только через encodeURIComponent, не исполнять в shell.
Внешние package manifests брать на соответствующих refs; module-guard должен
получать тот же набор каталогов payload, включая drive ref, и объединять пути.
Guard не должен молча проходить при отсутствии source/ref: в CI каталоги
готовятся явно (полный fetch нужных refs или локальные archives).
Не хранить machine-local абсолютные пути и секреты в manifest.
В README записать эти точные настройки установки двух независимых пакетов.

### Manifest и ownership

Не путать два manifest:

1. **Внешний пакетный:** `modules/drive/manifest.json`, например:

```json
{
  "name": "drive",
  "version": "1.0.0",
  "description": "Drive UI, routes and WebDAV mount",
  "requires": ["user"]
}
```

Это **целевой** контракт: нынешний readCatalogFromMap пока игнорирует requires.
Сначала добавить проверку requires в mod.mjs и тест; не выдавать JSON-поле
за уже работающий механизм. Фактические файлы определяет каталог `files/`.
`requires` должен проверяться до записи: обязательный `user` подтверждается
установленным `src/modules/user/manifest.json` с `required: true`, а не только
наличием папки. Это встроенная часть arch, не скачиваемый optional-пакет.
Для optional-зависимостей проверять итоговый состав всей операции, включая
снятие; недостающая зависимость или цикл — отказ без записи.

2. **Внутренний (обязательный для drive):**
   `modules/drive/files/src/modules/drive/manifest.json`: name drive,
   required false, dependsOn ["user"], entries с существующими публичными
   входами (как минимум ".": "./index.ts"). Внутренний version совпадает
   с внешним. Не добавлять install.targets: mod.mjs его не исполняет.

Перед записью модульный менеджер должен проверить конфликты путей **до любой
записи**, включая конфликт с уже установленным demo. Один файл имеет одного владельца: пересечение путей двух пакетов запрещено
даже при одинаковом содержимом, иначе снятие одного удалит файл другого.
Общий `+layout` или `HomePage` модулю не принадлежит и потому не входит в payload.

### 5.3. Безопасный жизненный цикл файлов — обязательный контракт

Источники определяют **допустимый payload**, но не доказывают владение
существующим файлом. Единственное доказательство владения — запись этого
пути за одним пакетом в `.modules/installed.json` с SHA-256 последней
установленной версии. Индекс Git ядра и защищённые пути имеют приоритет.

| Ситуация | Обязательное поведение |
|---|---|
| Новый путь отсутствует | Можно создать после проверки всей операции. |
| Путь существует, но нет записи владельца | Отказ, даже если байты совпадают. Не «усыновлять» файл и не разрешать overwrite через force; оператор сначала сохраняет/перемещает его вручную. |
| Путь отслеживается ядром или принадлежит другому пакету | Безусловный отказ, даже для одинаковых байтов и с force. |
| Обновление собственного файла, текущий SHA совпадает с recorded SHA | Можно заменить; записать SHA нового payload. |
| Собственный файл изменён локально | Обычные add/update/sync/remove отказывают. Только явный force разрешает заменить/снять **собственный** файл после сохранения резервной копии в private staging. |
| Собственный файл отсутствует | Обновление восстанавливает из payload; снятие убирает запись, отсутствие не ошибка. |
| Старый собственный путь исчез из новой версии | Удалять только при совпадении SHA; локальные изменения — отказ либо явный force с backup. Это правило действует и при обновлении, не только remove. |
| Remove пакета | Удалять только записанные за ним файлы. Не удалять каталог рекурсивно; убирать лишь действительно пустые родительские каталоги. Неизвестные/чужие файлы сохранять. |
| installed-state отсутствует, повреждён или содержит двух владельцев пути | Не угадывать ownership по исходнику/папке; прекратить мутацию, сообщить причину. Не менять файлы. |

Проверять пути входящего payload **и installed-state**: никаких абсолютных
путей, `..`, `.git`, env/секретов, выходов за app-root, symlink-переходов
или file/directory-коллизий. Защищённые arch-owned пути не разрешены даже force.
Новая версия не может добавлять права владения ядром через свой manifest.

Операция над несколькими пакетами сначала загружает и валидирует весь желаемый
состав, зависимости, ownership и SHA; только затем начинает изменения.
Не снимать старый пакет до успешной проверки источников новых пакетов.
Сначала создать план и backup затрагиваемых собственных файлов в приватном
каталоге вне payload/public assets; применить изменения с журналом восстановления,
записать state через atomic rename последним. При ошибке вернуть прежние файлы
и state; при сбое восстановления оставить журнал и запретить новые мутации
до завершения recovery. Параллельные мутации блокировать lock на app-root.
Backup принудительно заменённых/снятых локальных изменений сохранять и после
успеха, сообщать путь без содержимого; не удалять его как временный staging.
Обычные backup для rollback можно убрать после подтверждённого commit state.
Отдельные filesystem-rename не обещают атомарность всей операции: для этого
нужны журнал, rollback и проверка interrupted-operation перед следующим запуском.

### 5.4. Sync и идентичность установленной версии

Установщик должен:

1. установить `demo` без drive;
2. установить `drive` без demo;
3. установить `demo,drive` из заявленного источника;
4. удалить drive, оставив demo и ядро собираемыми;
5. удалить demo, оставив drive и ядро собираемыми;
6. не изменять чужие или неизвестные файлы **никогда**, а собственные
   изменённые — только по явно переданному force в рамках §5.3.

Убрать неявный force из sync. Каждый запуск с заданным MODULES разрешает
источники в конкретные OID, читает manifest и сравнивает payload digest и SHA
собственных файлов; наличие файлов само по себе не означает актуальность.
В state хранить repo, requested ref, resolved OID, version, payload digest
и map path→SHA-256; никакого токена/пароля в state.
При неизменном снимке и SHA операция no-op, при новой версии — безопасный
update по §5.3. Ошибка получения manifest не означает «снять пакет».
MODULES не задан — прежний no-op без сети; MODULES=none — явное снятие
только recorded optional-пакетов по тем же правилам. MODULES_SOURCE имеет
приоритет для офлайн-каталога; для него записывать digest вместо Git OID.

Не добавлять модулю права перезаписывать `src/core`, `src/routes/(site)/+layout`,
`src/sections/home/HomePage.svelte`, `package.json`, `package-lock.json` или
`tooling/mod.mjs`. Если для нового extension-контракта меняется arch, это
отдельный коммит/ветка arch, а не часть drive payload.

## 6. Зависимости работ

Единственный порядок: **A сохранить → B общие контракты → C упаковать →
D чистые снимки и проверки**. Не отделять drive и не требовать зелёной сборки
чистого arch до замены его ручных связей. Проверки четырёх составов выполняются
только после готовности обоих локальных снимков. Фаза D не требует push.

Минимальный тест «ядро не знает drive»:

```bash
git grep -n -E "#modules/drive|#sections/drive|/api/dav|/drive" -- \
  src/core src/routes src/sections tooling || true
```

Поиск — диагностический, не pass/fail сам по себе: /drive также встречается
в допустимой чистой библиотеке core/lib/drive и комментариях. Проверять каждое
совпадение; runtime-импорт optional drive, его endpoint, UI-ссылка или dav-ветка
в arch-owned файле недопустимы. Дополнительно проверить user/base. Команда
не видит untracked и не заменяет inventory, guard и сборку чистого снимка.

## 7. Порядок выполнения младшей моделью

Выполнять строго по фазам; не добавлять исключения в guard. До фазы D
исходное рабочее дерево может содержать локальный drive: оно не является
релизным снимком и не используется как доказательство отделения.

### Фаза A — сохранить исходники и определить снимки

- Сначала сохранить полный payload диска в отдельном каталоге внутри проекта.
  Не выполнять git clean/reset и не терять untracked-файлы. Проверить индекс:
  `/api/dav` был восстановлен через checkout и сейчас снова staged — не
  включить его повторно в arch-коммит. Разделять списки файлов явно.
- Составить inventory payload из §3 с SHA-256; сохранить неотслеживаемые
  исходники и отдельно исходные staged/unstaged правки. На этом шаге ничего
  не удалять и не обещать чистую сборку.
- Зафиксировать базовый arch OID и demo OID из refs/tags/modules. Если источник
  demo недоступен, остановить зависимые проверки с причиной, не заменять его
  четырьмя bundled-файлами и не считать demo проверенным.

### Фаза B — сделать generic extension points

- Перевести home entry and config step integration to generic contracts above.
- Ensure discovery runs once per module environment and is deterministic.
- Не добавлять новые импорты optional-модулей в src/core и исключения гардов.
  Существующие зависимости db.server на встроенный user остаются вне этой задачи.
- Реализовать MODULES_REFS, validation и весь ownership/lifecycle §5.3–5.4;
  согласовать module-guard и CI с обоими источниками. До упаковки проверить
  направленные fixture-тесты конфликтов, update/remove/rollback; не испытывать
  разрушительные сценарии в исходном рабочем дереве.

### Фаза C — собрать drive ref

- Add external package manifest and all payload paths from §3.
- Добавить обязательный внутренний manifest drive по §5; сверить package
  inventory и SHA с сохранёнными исходниками.
- Put `nav.ext.ts` in payload; do not add a drive line to arch files.
- Make routes, API and section files appear only after installing drive.
- Не merge/cherry-pick всей ветки приложения в пакет или обратно. Пакетную
  ветку `module-drive` создавать с modules/drive/manifest.json и files/...; в arch отправлять
  только изменения общих контрактов и библиотек. Коммиты/push — по отдельному
  разрешению владельца; этот аудит их сам по себе не разрешает.

### Фаза D — чистый arch и матрица из локальных снимков

Только теперь подготовить отдельный снимок arch без drive payload и без
установленного demo. Сохранённый drive не удалять до сверки inventory.
Не копировать целиком грязное рабочее дерево. Снимок drive содержит только
modules/drive/**; библиотечный WebDAV переносить в него запрещено.

До публикации собрать единый офлайн-каталог `.audit-input/catalog` внутри
проекта из **зафиксированных** modules/demo/** и подготовленного modules/drive/**.
Никакие остальные файлы веток в каталог не входят. Записать исходные OID,
SHA-256 manifest и digest каждого payload. Один и тот же каталог используется
в четырёх независимых чистых app-копиях `.audit-check/{none,demo,drive,both}`.
У каждой своя .modules/installed.json. Не запускать remove в исходной копии.
Каждая app-копия — отдельный локальный Git checkout/репозиторий с индексом
именно подготовленного arch; не дочерняя папка, для которой git ls-files
случайно прочитает индекс родительского грязного repo. Module-guard получает
тот же MODULES_SOURCE с обоими каталогами и проверяет полный их union даже
при MODULES=none. Каталог входов, backup и проверочные копии не входят в arch
и не сканируются как исходники приложения.

В каждой app-копии задать абсолютный путь к этому сохранённому каталогу:

```bash
export MODULES_SOURCE='<абсолютный путь внутри проекта>/.audit-input/catalog'
export MODULES_REPO='ftugit/modals-kit'
export MODULES_REF='refs/tags/modules'
export MODULES_REFS='{"demo":"refs/tags/modules","drive":"refs/heads/module-drive"}'
export DATABASE_RESET='0'
# Для каждой отдельной копии выбрать ровно соответствующий состав:
# none → none; demo → demo; drive → drive; both → demo,drive
export MODULES='none'
npm run mod -- sync
KIT_ADAPTER=node npm run check
node --test tooling/*.test.mjs
node tooling/module-registry.mjs
node tooling/public-api.mjs
node tooling/module-guard.mjs --tracked
KIT_ADAPTER=vercel npm run build
```

Выбор remote refs проверяется fixture-тестом loader: demo запрашивается из
refs/tags/modules, drive из refs/heads/module-drive; чужой пакет из архива игнорируется,
ошибка/отсутствие manifest даёт отказ до записи. Офлайн MODULES_SOURCE проверяет
точные payload без публикации, но не доказывает доступность будущей remote-ветки.
Для будущей remote-установки используются настройки §5.2 с unset MODULES_SOURCE;
эту проверку не выдавать за выполненную до разрешённой публикации.

Эти команды выполняет реализация, не автор документа. Каждый состав проверять
в отдельной чистой копии внутри проекта; задавать явный MODULES_REFS, а не
полагаться на .env.local. Не использовать production DB или DATABASE_RESET=1;
для сборок отключить reset и использовать локальную тестовую БД. При pipeline
сохранять код команды через set -o pipefail. Не заявлять Vercel pass по Node build.

Run drive tests only after installing drive:

```bash
npx vitest run src/core/lib/drive src/modules/drive src/sections/drive
node tooling/drive-path-guard.mjs
```

Проверить снятие в двух дополнительных независимых копиях состава both,
с тем же MODULES_SOURCE. Явно синхронизировать итоговый состав, чтобы build
не установил снятый пакет обратно:

```bash
# Копия removal-drive: оба → только demo → none
MODULES=demo npm run mod -- sync
MODULES=demo KIT_ADAPTER=vercel npm run build
MODULES=none npm run mod -- sync
MODULES=none KIT_ADAPTER=vercel npm run build
# Копия removal-demo: оба → только drive
MODULES=drive npm run mod -- sync
MODULES=drive KIT_ADAPTER=vercel npm run build
```

После каждого перехода сверить state/пути: снятый payload отсутствует,
SHA оставшегося пакета и arch-owned файлов не изменились. Новые сборки
в этой фазе — локальная проверка adapter-vercel, **не** деплой Vercel.

A successful build must be the exact branch/ref composition intended for
publication. Do not use a local untracked drive directory as evidence.

## 8. Definition of done

- `arch` has no tracked drive payload and no drive-specific UI/API/route/config
  references; `module-guard --tracked` passes on arch and CI runs it for arch.
  A diagnostic grep is reviewed, not used as a blind textual criterion.
- `core/lib/storage/webdav` is reusable and split into isomorphic and server
  entrypoints; client builds never import server implementation.
- `arch` builds and typechecks with `MODULES=none` and `MODULES=demo`.
- `drive` устанавливается из офлайн-снимка MODULES_SOURCE; маршрутизация refs
  подтверждена fixture-тестом. Проверка remote ref — отдельный отложенный gate
  после разрешённой публикации, не условие локального завершения этого плана.
  Пакет владеет всеми файлами §3 и не меняет arch-owned файлы.
- `drive` builds alone on arch and with demo; removing either module leaves the
  other buildable.
- Минимальные направленные тесты: сборка nav дважды даёт одинаковые списки
  без роста; homeEntries не требует drive при пустом glob; config registry
  показывает dav только при установке; mod отказывает двум владельцам одного
  пути до записи и не удаляет данные БД. Не нужны массовые UI-эксперименты.
- `module-registry` validates only manifests actually present after install;
  `mod` validates external manifest and dependency before writing.
- No guard exception was added for drive, no `force` conflict was hidden, and
  no database/storage data was deleted during module removal. Unknown,
  unowned, core-owned and other-module-owned paths are never force-removable.
- README in arch explains the generic module contract; drive README explains
  source/ref, install, remove, test and branch publication commands.

## 9. Expected final Git layout

`arch`:

```text
src/core/lib/drive/                  # reusable pure library
src/core/lib/storage/webdav/**       # protocol/client/common server
src/core/hooks/module-ext.ts         # generic extension contracts
src/core/app/nav.ts                  # pure navigation builder
src/composition/nav.ts               # module discovery and readonly result
src/core/server/db.server.ts         # generic db.ext discovery
src/hooks.server.ts                  # generic init/form discovery
src/routes/(site)/+layout.svelte     # generic host only
src/sections/home/HomePage.svelte   # generic home entries only
src/modules/user/**
src/modules/storage-servers/**
tooling/mod.mjs, module-guard.mjs
```

`drive` package:

```text
modules/drive/manifest.json
modules/drive/files/src/modules/drive/**
modules/drive/files/src/sections/drive/**
modules/drive/files/src/routes/(site)/(app)/drive/**
modules/drive/files/src/routes/(site)/(app)/user/config/dav/**
modules/drive/files/src/routes/api/dav/[...path]/+server.ts
modules/drive/files/tooling/drive-path-guard.mjs
```

The package may include its tests and docs under `modules/drive/files/`, but
must not include arch-owned files merely to make imports resolve.

## 10. Final answer expected from the implementer

Report exactly:

- files moved from arch to drive package;
- generic contracts added to arch;
- source/ref and resolved OID used for each installed module;
- builds/tests for `none`, `demo`, `drive`, `demo,drive`;
- proof that `module-guard` and `module-registry` pass;
- proof that removing drive leaves demo/arch buildable;
- any skipped browser/auth checks and why.

Do not claim module separation is complete from a single Vercel READY result.
