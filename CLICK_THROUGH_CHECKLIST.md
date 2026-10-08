# Чек-лист: click-through при закрытии select/меню по оверлею

Дата: 2026-10-08. Ветка: `b1` (клон в `/home/user/modals-kit`, origin = https://github.com/ftugit/modals-kit).

## Исходная задача

Пользователь: select и всплывающие меню используют второй слой оверлея (backdrop машины
`sheetDialog` в `ModalHost.svelte`). При попытке закрыть select/меню тапом по оверлею
срабатывают элементы ЗА оверлеем (например, открывается нативный select под оверлеем;
раньше «чинили» такие элементы по одному). Нужен корень проблемы, а не точечные фиксы.
Баг найден на мобильной версии; проверить, нет ли похожей болячки на ПК.
Тестовый сценарий от пользователя: пагинатор → источник Shikimori → любой select/multiselect,
чтобы через полупрозрачный оверлей были видны другие элементы.

## Окружение и состояние

- Песочница: Debian 13, x86_64, Node v20.20.2, npm 10.8.2, Playwright 1.63.0 (проект) +
  chromium headless shell 153 (скачан через `npx playwright install chromium` в проекте).
- `/tmp` — tmpfs (эфемерный); `/home/user` — постоянный. Проект склонирован в `/home/user/modals-kit`.
- Зависимости: `npm ci` — выполнено. Dev-сервер: `npm run dev -- --port 5173 --host 0.0.0.0`
  (запущен в фоне, процесс `modals-kit-dev-server-aee5ba6b`, порт 5173).
- Shikimori API доступен через бэкенд (`/api/shikimori/terms` отвечает 200).
- Playwright-окружение проверено реальным запуском браузера (data-URL, чтение DOM, evaluate).

## Как устроено (discovery)

- `src/lib/modals/svelte/ModalHost.svelte` — хост модальной системы. Две Ark-машины Dialog:
  основная (стопка модалок, один `Dialog.Backdrop` с `data-modal-backdrop`) и **вторая
  `sheetDialog`** — её backdrop и есть «второй слой оверлея» для листов (select/меню на
  узком экране, `data-layout="sheet"`). Select открывается через `host.floating.openFlow`,
  на узком экране floating становится headless-записью цепочки + машиной `sheetDialog`
  (`isSheet`, `sheetSurface`, `ids.content = surfaceId`).
- Закрытие по «вне» идёт на `pointerdown`: document-level capture-слушатель `onPointerDown`
  в `$effect` (активен пока `floatings.length > 0`) закрывает floating'и и армирует
  `swallowClickOnce` — он гасит только завершающий `click` (preventDefault+stopPropagation,
  окно 700 мс, ±3 px). Ark `onInteractOutside` → тот же `closeFloating` (с guard
  `lastFloatingClosedAt < 150`).
- При открытом листе zag выставляет `body { pointer-events: none }` (модальность),
  поэтому тап по оверлею имеет target `html` — это «щит» (`pointerStartedOnShield`).
- `Select.svelte` (путь ОТКРЫТИЯ) уже потребляет жест: `interceptPointer` делает
  `preventDefault()` на pointerdown триггера. Путь ЗАКРЫТИЯ (хост) этого не делал.

## Воспроизведение (доказано, `probes/click-through-repro.mjs`)

Мобильный контекст (390×844, touch): /paginator → источник `animes` → раскрыть
`<details data-testid="filters-details">` (панель фильтров свёрнута!) → тап по первому
select → лист открыт. Тап по оверлею в точке (28, 30), под которой лежит
`select[name=page.bottomZone]`:

```
pointerdown → html          (щит; хост закрывает лист, снимает замок страницы)
pointerup   → html
mousedown   → select[name=page.bottomZone]   ← ПРОСОЧИЛСЬ
focusin     → select[name=page.bottomZone]   ← фокус украден элементом под оверлеем
mouseup     → select[name=page.bottomZone]   ← ПРОСОЧИЛСЬ
click       → select[name=page.bottomZone]   (заглушён swallowClickOnce)
```

## Корень проблемы

**Dismiss-жест не потребляется.** Хост снимает оверлей на `pointerdown`, но не отменяет
сам жест. Совместимые mouse-события (`mousedown`/`mouseup`) летят следом — к этому
моменту оверлей уже снят, а замок страницы (`body { pointer-events: none }`) уже
сброшен, поэтому hit-test находит элемент ПОД оверлеем: он получает `mousedown`,
фокус (`focusin`) и т.д. Гасится только `click` — поэтому «чинили по одному элементу»
(кнопки спасал click-swallow, а нативный select — нет: он реагирует на mousedown/фокус).

Спецификация Pointer Events (§11): отмена `pointerdown` подавляет совместимые
`mousedown`/`mouseup` (PREVENT MOUSE EVENT flag); `click` приходит ВСЕГДА и гасится
отдельно. Эксперимент `probes/test-preventdown.mjs` подтвердил в Chromium 153:
с `preventDefault()` на pointerdown по щиту `mousedown`/`mouseup` не приходят вовсе,
фокус не крадётся (остался только штатный restoreFocus на триггер), `click` гасится
swallowClickOnce.

## Решение (итоговая, ужатая форма)

В `ModalHost.svelte` `onPointerDown`: когда жест начат на щите (`pointerStartedOnShield`)
или на контроле модалки за floating (`targetBehindFloating`, уже было) и floating закрыт —
**`event.preventDefault()`** выполняется для ОБОИХ случаев (раньше — только для
`targetBehindFloating`). Платформа подавляет хвостовые `mousedown`/`mouseup` и их
умолчания (фокус, :active, активация нативного select). Завершающий `click` (который
браузер обязан доставить) гасит штатный `swallowClickOnce` — окно 700 мс/±3 px,
снятие по `pointercancel`/таймауту.

Изначально фикс включал усиленный `swallowTrailingGesture` (гасил весь хвост
`mousedown`/`mouseup`/`click` со снятием по следующему pointerdown) как defense-in-depth
для браузеров без suppression. На ветке лежит жёсткий гейт веса (`tooling/size-budget.mjs`,
«do not raise them» — запрет поднимать бюджеты), и новая версия `15d4355` сидит ровно на
пределе. После ребейза фикс сжат до минимальной формы: `preventDefault` + штатный
`swallowClickOnce` — добавка в gzip-бандл ~2 байта вместо ~50. Ограничение: на очень
старых движках без suppression (Chrome Android <78, react#17166) хвостовые
`mousedown`/`mouseup` теоретически могут просочиться; в актуальных Chromium/WebKit/Gecko
механика подавления работает.

Отклонено: задержка закрытия до `pointerup`/`click` (оверлей всё равно снимается до
хвостовых событий), «щит после закрытия» на 350 мс (тормозит повторный тап), правки
отдельных элементов (точечные костыли — причина, по которой за задачу взялись).

Desktop: тот же фикс покрывает случай «модалка + popup, клик по фону модалки» (щит).
Случай «popup без модалки, клик по элементу страницы» — НЕ баг: клик сознательно
активирует элемент (политика в коде: «Page-level targets outside a modal remain
actionable», напр. кнопка «Применить» формы фильтров). Проверить регрессией.

## Этапы

1. [x] Воспроизвести баг и найти корень (repro + test-preventdown, см. выше).
2. [x] Правка `src/lib/modals/svelte/ModalHost.svelte`: `event.preventDefault()` на
   dismiss-жесте для обоих случаев (щит и контроль модалки за floating); `click`
   гасит штатный `swallowClickOnce` (см. «Решение» — после ребейза фикс сжат до этой
   минимальной формы из-за бюджета веса).
3. [x] Проверить fix: `probes/click-through-repro.mjs` — нет mousedown/mouseup/focusin
   утечки, лист закрыт, фокус на триггере, повторный тап переоткрывает лист,
   прямой тап по элементу под бывшим оверлеем доставляется. Прогон на dev (5173) и на
   production preview (4173, сборка с фиксом) — чисто.
4. [x] Регрессия R-26 в `test/browser/regressions.mjs` (мобильный: тап по оверлею листа
   не активирует элемент под ним; следующий тап — активирует). Зелёная.
5. [x] Прогоны (все зелёные):
   - `npm run test:unit` — 493 passed;
   - `npm run check` (svelte-check) — 0 ошибок (45 штатных варнингов);
   - `node --test tooling/` — 64 pass / 0 fail (layer-guard и др. стражи);
   - `npm run build` — собралось; `npm run test:size` — гейт сидит на пределе и
     краснеет/дрожит уже на чистой базе (см. «Обновление upstream»; фикс добавляет
     ~2 байта gzip, бюджеты не поднимались);
   - браузерные против preview :4173 (финальный прогон после ребейза на `15d4355`
     с минимальной формой фикса): regressions 47 (включая upstream-R-25 и наш R-26),
     modals 49, shell 7, forms, forms-a11y, paginate, capabilities — все прошли;
     repro и A/B-матрица — чисто, desktop-проба — утечек нет.
   - замечание: dev-сервер на 5173 был убит OOM (SIGKILL) песочницы; формы запущены
     с `FORMS_BASE=http://127.0.0.1:4173/form` против preview.
6. [x] Локальные git-коммиты в ветке `b1` (без push/PR); после обновления upstream —
   rebased на `15d4355`, хеши смотреть в `git log`.
7. [x] Чеклист обновлён.
8. [x] A/B-доказательство корневого характера фикса (`probes/click-through-matrix.mjs`):
   одна и та же матрица (тап по оверлею листа над целью разного типа — нативный
   select, кнопка «Применить», поле поиска) прогнана на обеих сборках.
   - **База (HEAD~1, без фикса)**: утечки. Repro — `mousedown`/`focusin`/`mouseup`
     дошли до `select[name=page.bottomZone]` за оверлеем, фокус украден. Матрица 3/3
     прогона — хвостовые `mousedown`/`mouseup` доставлены после снятия оверлея; в
     одном из прогонов они дошли до самой кнопки «Применить» (вместе с `focusin`).
     Это гонка: если оверлей успевает сняться до хвостовых событий — они уходят
     элементу под ним, если нет — самому backdrop (безвредно, но того же жеста).
   - **Фикс**: матрица 3/3 типа «ЧИСТО» — 0 событий доставлено хоть
     куда после снятия оверлея, фокус не украден, побочных открытий нет, лист закрыт;
     exit 0. Repro — 0 событий элементу под оверлеем, фокус на триггере.
   Тот же probe, тот же сценарий, разный только `ModalHost.svelte` — фикс устраняет
   механизм (потребление dismiss-жеста), а не «текущую версию» по элементам.
   (A/B делался на усиленной версии фикса; после сжатия до минимальной формы матрица
   прогнана заново на пост-ребейз сборке — 3/3 «ЧИСТО», repro и R-26 — зелено.)

## Обновление upstream и rebase (вечер 2026-10-08)

В `origin/b1` пришла новая версия — три коммита поверх нашей базы `f82734f`:
`dc03bdc` (share controls / JS-only settings на /form и /modals), `e9093b6`
(no-op guard в `Select.commit` + **свой R-25** в regressions), `15d4355`
(ужимание контрол под бюджет; `tooling/size-budget.mjs`: глобальные лимиты
сведены к 203/190 KiB с комментарием «do not raise them to accommodate this change»).
Фикс пересажен на `15d4355` (`git rebase --onto origin/b1 f82734f`), где:

- конфликт в `test/browser/regressions.mjs` разрулен сохранением обоих тестов:
  upstream R-25 (no-op события) + наш, перенумерованный в **R-26**;
- фикс сжат до минимальной формы (см. «Решение») — бюджет веса не оставляет места
  на усиленный swallow;
- наблюдение: **гейт веса красный уже на чистой базе** `15d4355` (весь JS 194564…194568
  байт gzip против лимита ровно 194560; флуктуация ±4 байт из-за хешей чанков в
  import-путях). Это не следствие фикса: добавка фикса ~2 байта gzip. Бюджеты
  по указанию мейнтейнера не поднимаются.

## Итог

Корень устранён в хосте (один фикс для select И меню, мобильный и desktop): жест,
которым пользователь закрывает оверлей, потребляется — `pointerdown` отменяется
(платформа по спецификации подавляет совместимые mousedown/mouseup), а гарантированно
доставляемый `click` гасит штатный `swallowClickOnce` (700 мс/±3 px).
Точечных костылей не добавлено; политика «клик по элементу страницы вне модалки
активирует его» (напр. «Применить» фильтров) сохранена.

## Команды

- Preview: `npx vite preview --port 4173 --host 0.0.0.0 --strictPort` (сборка из `npm run build`;
  пересборка под запущенным preview ломает раздачу — сервер надо перезапускать).
- Repro: `node probes/click-through-repro.mjs [baseUrl]` (баг до правки / чисто после).
- A/B-матрица: `node probes/click-through-matrix.mjs [baseUrl]` (exit 0 = чисто, 1 = утечки).
- Эксперимент preventDefault: `node probes/test-preventdown.mjs`.
- Регрессии: `MODALS_PORT=4173 node test/browser/regressions.mjs` (и с фильтром `R-26`).
- Unit: `npm run test:unit`. Typecheck: `npm run check`. Tooling: `node --test tooling/`.

## Следующий шаг

Работа завершена: фикс в минимальной форме лежит на ветке `b1` поверх `15d4355`
(2 локальных коммита — фикс+регрессия и probe-набор; хеши в `git log`), A/B-матрица
в `probes/click-through-matrix.mjs`, проверки зелёные. Красный `test:size` —
предыстория гейта upstream (база на пределе), бюджеты не поднимались. Push/PR —
только по явной просьбе владельца.
