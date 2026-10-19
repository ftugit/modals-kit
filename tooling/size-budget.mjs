#!/usr/bin/env node
/**
 * Проверка бюджетов веса клиентской сборки.
 *
 * Требует готовой сборки SvelteKit:
 *
 *   npm run build
 *   node tooling/size-budget.mjs
 *
 * Считаем gzip по реальным файлам из .svelte-kit/output/client. Бюджеты
 * заданы с небольшим запасом к текущей демо-сборке: они ловят случайное
 * добавление тяжёлой зависимости, но не заставляют править хэшированные имена.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const KiB = 1024
const CLIENT_ROOT = '.svelte-kit/output/client'
const IMMUTABLE_ROOT = join(CLIENT_ROOT, '_app/immutable')
const MANIFEST = join(CLIENT_ROOT, '.vite/manifest.json')
// Сгенерированное SvelteKit лежит раздельно: `generated/build` (сборка) и `generated/dev`.
// Читать надо именно файл сборки — иначе бюджет считается по чужому app.js (ход 16, B9).
const GENERATED_APP = '.svelte-kit/generated/build/client-optimized/app.js'

// Лимиты подняты 2026-10-07 (этапы 1–4): общий слой источников с возможностями,
// серверная схема фильтров Shikimori, её клиентская часть (ключи адреса, схема,
// связки) и панель фильтров с формой на схеме добавили ~34 KiB gzip — это
// функциональность, а не случайная зависимость.
// Запас остаётся минимальным (факт 200.7 / 187.8 / 12.9 — с подписями полей фильтров и причиной сбоя схемы): гейт по-прежнему ловит
// и новую тяжёлую зависимость, и рост клиентской части схемы.
// Issue 11 (2026-10-08): shared demo controls and JS-only settings fit the
// original global budgets; do not raise them to accommodate this change.
// REVISION 2026-10-09 (решение оператора, этап 6–7 закрытия): «подними на 10%
// все» — лимиты подняты ровно на 10% (факты после этапов 5–6: 208.5 / 195.5 /
// 13.0 / 47.7; маршруты /form 151.5, /paginator 123.0). Правило «рост докладывать»
// остаётся: поднятие — акт оператора, не исполнителя.
// REVISION 2026-10-11 (решение оператора, ход 12): исправления F28/F36 (проверка
// цвета/якоря из адреса) и загрузчика F30/F32–F34 дали 209.2 > 209.0 KiB «весь JS».
// Оператор: «поднимай сейчас и в подобных сценариях на 5кб сразу всегда» —
// allJsGzip 209 → 214. Прочие лимиты не тронуты (не превышены).
// REVISION 2026-10-11 (ход 16, переезд на SvelteKit 3, B1): рантайм Kit 3 дал +3.5 KiB
// (226.8 > 223.3 все immutable; /modals 153.6 > 150.0); код приложения между замерами —
// только замена pushState/replaceState на goto({ shallow }). По постоянному решению
// оператора («поднимай на 5кб сразу») — allImmutableGzip 223.3 → 228.3, /modals 150 → 155.
// REVISION 2026-10-11 (ход 27, C2 — каркас и модальные системы по группам папок):
// весь JS 213.8 → 218.1, все immutable 227.0 → 231.3, /modals 154.0 → 157.5; прочие
// маршруты легче на 4.9 (реестр демо-модалок больше не в корневом layout). Модули
// не дублируются — большой общий чанк (51.6) разошёлся на несколько (svelte 32.5,
// primitives 10.8, classes 9.8, shell 5.9): gzip по частям хуже, плюс узлы групп.
// По постоянному решению оператора — +5: 228.3 → 233.3, 214 → 219, /modals 155 → 160.
// REVISION 2026-10-12 (ход 40, F54 — Rick and Morty REST/GraphQL в демо-пагинаторе):
// весь JS 220.0 > 219.0 (+2 вьюхи персонажа, клиент источника, статическая схема).
// По постоянному решению оператора — +5: 219 → 224. /paginator 188.5 / 196.5 — в пределах;
// все immutable 233.3 / 233.3 — на границе, не превышен, не тронут.
// REVISION 2026-10-12 (ход 42, F39 — якорь при открытом слое заменяет запись истории):
// все immutable 233.6 > 233.3 (обработчик клика по якорю в слое роутера). По постоянному
// решению оператора — +5: 233.3 → 238.3. Остальные лимиты не тронуты.
// REVISION 2026-10-14 (ход 112 — серверная ошибка закреплена за значением поля, `pins.ts`;
// экран схемы на перехваченной отправке): весь JS 224.02 > 224.0. По постоянному решению
// оператора — +5: 224 → 229. Остальные лимиты не тронуты.
// REVISION 2026-10-14 (ход 117 — поля формы на примитивах: PasswordInput, NumberField,
// OtpInput, SearchInput, Switch): сборщик кладёт их в общий чанк примитивов (рядом с
// Select), поэтому +1.5 приходят на каждый маршрут, как в ходе 95. Все immutable
// 240.6 > 238.3; /modals 165.4, /db-demo 184.5, /cycle 130.6, /spike 125.4,
// /cards/[id] 132.2. По постоянному решению оператора — +5 каждому превышенному.
// REVISION 2026-10-14 (ход 119): по решению оператора («добавь несколько кб») — +3 КиБ
// каждому лимиту вместо дробления чанка примитивов: все immutable 246.3, весь JS 232,
// /form 168, /paginator 199.5, /db-demo 190.5, /modals 173, /cycle 137.1, /spike 131.8,
// /cards/[id] 138.6.
// REVISION 2026-10-14 (ход 141 — Link вместо LoadLink, ModalTrigger рядом с ним в
// components/links): сам код ссылки (своя предзагрузка, проверка роута, индикатор)
// ≈0.5; остальное — сборщик разложил общий код на больше мелких чанков (адаптер
// роутера, components/links, components/modals отдельно), набор модулей маршрутов прежний.
// Против c6eda0e: весь JS 231.4 → 233.8, immutable 244.5 → 246.8, /form 166.0 → 168.8,
// /paginator 197.3 → 200.2, /db-demo 189.9 → 192.8. Дробление чанков отклонено в ходе
// 127 — по постоянному решению (≤ +5, сообщить): весь JS 234.5, immutable 247.5,
// /form 169.5, /paginator 201, /db-demo 193.5.
// REVISION 2026-10-14 (список БД: локальные правки окна `patchItems` в ядре пагинатора,
// опрос «что появилось» вместо переспроса окна): факт весь JS 234.8, immutable 248.2,
// /db-demo 194.3, /paginator 201.0 (ядро общее). По постоянному решению (≤ +5, сообщить):
// весь JS 236, immutable 249.5, /db-demo 195.5, /paginator 202.
// REVISION 2026-10-15 (фильтры = обычная форма: своё описание и компонент под схему,
// поля — общий `Field` форм, `filterParams`, валидаторы notAbove/notBelow/noOverlap;
// `Field` берёт только выбор компонента, без транспорта и проверок): факт весь JS 236.5
// (+1.7), immutable 249.9 (+1.7), /form 169.8 (+0.8), /paginator 204.6 (+3.6). По
// постоянному решению (≤ +5, сообщить): весь JS 237.5, immutable 251, /form 170.5,
// /paginator 205.5.
// REVISION 2026-10-15, ход 185 (формы и БД: форма строится из модели — `formParams(posts)`, модель
// `posts` теперь общий модуль и едет в браузер со своим `lib/db`: `defineResource`, схемы
// `s.*`, переходник; плюс флажок согласия, подсказка `prepare`, адрес записи в строке).
// Таблица SQLSTATE (≈9 КБ) из браузера убрана пометкой `@__PURE__`. Факт: весь JS 236.5 →
// 242.2 (+5.7), immutable 249.9 → 255.7 (+5.8), /db-demo 195.3 → 201.1 (+5.8), /form
// 169.8 → 170.0. Решение оператора («Да, увеличивай»): весь JS 243, immutable 256.5,
// /db-demo 201.5.
// REVISION 2026-10-15, ход 189 (глобальный лоадер, src/lib/task/README.md):
// полоска сверху в корневом layout — на КАЖДОМ маршруте +1.1–1.2. Факт: весь JS 243.2,
// immutable 256.8, /form 171.1, /paginator 206.0, /db-demo 202.3, /cards/[id] 138.7.
// По постоянному решению оператора (+5, сообщить): весь JS 244, immutable 257.5, /form 171.5,
// /paginator 206.5, /db-demo 203, /cards/[id] 139.5.
// REVISION 2026-10-15, ход 189 (часть Б того же плана): чтение строк хода в браузере
// (`#lib/fetch` `readTaskStream`/`fetchWithTask`, ≈1 КБ gzip) у формы и источников списков.
// Факт: весь JS 244.9, immutable 258.5, /form 172.3, /paginator 207.5, /db-demo 203.7.
// То же решение (+5, сообщить): весь JS 245.5, immutable 259, /form 173, /paginator 208,
// /db-demo 204.5.
// REVISION 2026-10-15, ход 198 (исправления пагинатора: сравнение «ключа нет = умолчание»
// при оживлении, стартовая страница у роутера; `timestamps`/`restore`/`liveCapabilities` в
// `lib/db` — модель `posts` едет в браузер вместе с `defineResource`). Факт: весь JS 245.7
// (+0.8 к ходу 189), immutable 259.3, /db-demo 204.5+ (порог), /paginator 207.7, /form 172.3.
// По постоянному решению оператора (≤ +5, сообщить): весь JS 246.5, immutable 260,
// /db-demo 205.5.
// REVISION 2026-10-17, ход 216 (автоматика модели lib/db, шаги 1–8: проверки объявления модели —
// маски, `without`, цепочка, ключи доступа — едут в браузер вместе с `defineResource` модели
// `posts`). Факт: весь JS 246.5, immutable 260.0, /db-demo 205.3. То же решение (+5, сообщить):
// весь JS 247.5, immutable 261, /db-demo 206.
// REVISION 2026-10-16, ход 224 (страница `/fields`: конструктор полей на `defineFieldKit`,
// поле файла `FileField` в общем `resolve`). Весь JS растёт на код самой страницы (+6.7 к
// ходу 216 — больше постоянных +5, вынесено владельцу). Маршруты с формой: +1.5 — набор
// (`kit.ts`) экспортирован из индекса `#lib/form` и едет в общий чанк формы; +0.7 — поле
// файла. Отдельная точка входа `#lib/form/kit.js` вернула бы 1.5 — решение за владельцем.
// Факт: весь JS 253.2, immutable 266.9, /form 174.5, /modals 174.5, /paginator 210.0,
// /db-demo 207.7, /fields 169.9.
// REVISION 2026-10-16, ход 228 (набор полей — поле формы `field.fields`, сохранённый набор —
// `defineForm({ from })`): каталог (`kit.ts`) теперь нужен сахару `field.*` и едет в общий
// чанк формы, компонент места под поля (`FieldSetField`) — в общий `resolve`. Строки `/form`
// убраны (−). Весь JS +0.5 (253.7). Маршруты с формой: /form 177.0, /modals 175.4,
// /paginator 212.9, /db-demo 210.5 (+0.9…2.9). Лимиты = факт + ≈0.5, сообщено владельцу.
// REVISION 2026-10-16, ход 236 (места набора расставляет приложение — хук `fieldSet`; кнопки
// набора без JS; места для разметки в ядре `field-set.ts`, он в общем чанке формы; компонент
// `FieldSetField` из общего `resolve` убран). Факт: весь JS 254.1, immutable 267.8, /form 176.3 (−0.7),
// /modals 176.6, /fields 171.2. Лимиты = факт + ≈0.5, сообщено владельцу.
// REVISION 2026-10-16, ход 237 (чистка lib/form: удалены редактор набора и строки групп
// `editor.ts`, `form.apply`/`form.rows`/`form.custom`, продолжение, стратегия файлов, devtools,
// `createAppSource`, пометка `fresh`). Факт: весь JS 252.9 (−1.2), immutable 266.6, /form 175.0,
// /modals 175.3, /paginator 210.9, /db-demo 208.5, /fields 169.9. Лимиты опущены до факт + 0.5.
// REVISION 2026-10-16, ход 241 (демо `/form` покрывает остальное lib/form: url, период дат,
// время, ползунок `RangeField`, цвет, файлы списком, скрытое `HiddenField`, видимость,
// проверка части полей, ответы сервера, описания опций панели). Весь JS +2.7 (255.6),
// immutable 269.3, /form 177.7 (+2.7). По постоянному решению (≤ +5, сообщить): факт + 0.5.
// Ход 242 (симуляция очереди на `/form`: опрос `pollUntilDone`, итог в форму): +1.0 —
// весь JS 256.6, immutable 270.3, /form 178.7 (всего +3.7 к ходу 237). Лимиты = факт + 0.5.
// Ход 242, ошибка курсора (`errorCode`, «Начать сначала» в `ErrorRow`): /paginator 211.1 → 211.4,
// /db-demo 208.8 → 209.0. Лимиты = факт + 0.5.
// Ход 246, адрес — у адаптеров (`linkFor`, `fieldName`, `carryFields`), ссылки «Начать сначала»/
// «Повторить»/«Сброс», `LiveStatus` вместо текстов хоста: весь JS 256.8 → 257.1, immutable 270.5 → 270.8,
// /paginator 211.4 → 211.7, /db-demo 209.0 → 209.4. Лимиты = факт + 0.5.
// Ход 248, `/fields` шагами (сборка → заполнение → результат), правило вида в списке «Правила»,
// сброс правил при смене вида, предел длины у времени и id строки БД: весь JS 257.1 → 258.2,
// immutable 270.8 → 271.9, /fields 170.2 → 171.3. Лимиты = факт + 0.5.
// Ход 250, бронь ключей адреса (`lib/address/keys`) и шаги компонентом (`Steps` над адресом):
// алгебра и компонент легли в общий чанк — весь JS 258.2 → 259.5, immutable 271.9 → 273.2,
// каждый маршрут +0.3…+0.8 (/fields 171.3 → 172.6). «≤ +5 КБ, сообщить». Лимиты = факт + 0.5.
const LIMITS = {
  // Ход 251, модуль пользователя: виджет авторизации (пять шагов одной формы,
  // bind+Form) + аватарный конвейер ленивыми чанками (compressorjs ~8 КБ,
  // @jsquash/jpeg mozjpeg ~22 КБ — грузится только при первом файле) + UserMenu
  // в шапке ветки. Весь JS 259.5 → 288.0, immutable 273.2 → 301.7, /form
  // 180.0 → 183.4 (UserMenu в layout ветки). Рост ЗА пределом «+5» — сообщено
  // владельцу в отчёте хода. Лимиты = факт + 0.5.
  // Ход 257, адаптеры api на lib/db: клиенту — общий kitActionTransport с devalue
  // (unwrap общий, локальная копия в vault удалена), localPath в lib/address, тексты
  // доменных кодов в форме входа. Весь JS 288.0 → 288.3, immutable 301.7 → 302.1,
  // маршруты +0.2…+2.7 (/modals 180.0 → 182.2 — тянет transport). Лимиты = факт + 0.5.
  // Ход 258, ремонт авторизации: HoldButton (блокировка до заполнения, hover-заливка,
  // мобильные запреты выделения, submitter себе) + проводка полей seed/nickname в
  // виджете + иконки копирования. Весь JS 289.3 → 290.0, immutable 303.1 → 303.8.
  // Ход 258, FileInput с превью выбранных файлов (опция variant: 'preview',
  // по образцу Attachment из shadcn): JS 290.5 → 290.7, immutable 304.3 → 304.5.
  // Ход 260, миниатюры превью через compressorjs (решение владельца; зависимость
  // уже стояла ради аватара — тот же ленивый чанк; шим типов src/compressorjs.d.ts
  // удалён — пакет сам несёт types): JS 290.7 → 291.3, immutable 304.5 → 305.1;
  // FileInput статически в шапке (AuthWidget), поэтому +0.3…+0.5 на каждом
  // маршруте — в пределах «≤ +5», лимиты = факт + 0.5.
  // Ход 261: CopyInput (иконки выполнено/восклицание, 5 с), общий MenuBody
  // (модалка + роут /user/menu), Field `instead` (CopyField) — всё статически
  // в шапке/чанке форм: JS 291.3 → 292.1, immutable 305.1 → 305.9, маршруты
  // +0.2…+0.4. В пределах «≤ +5», лимиты = факт + 0.5.
  // Ход 262: универсальная демо-панель (`#lib/components/demo`) — схема→форма,
  // адрес через lib/address, параметры наружу. /steps переведён на неё: факт
  // 315.0 / JS 300.9 / /steps 184.5. В пределах «≤ +5» на ход, лимиты = факт + 0.5.
  // Ход 264: панель модалок — на универсальном DemoPanel (этап 3): факт
  // 316.5 / 302.4. Лимиты = факт + 0.5.
  allImmutableGzip: 317.0 * KiB, // 261 (310.2); 263 (315.6); 264: /modals → DemoPanel
  allJsGzip: 302.9 * KiB, // 261 (296.4); 263 (301.5); 264: /modals → DemoPanel
  allCssGzip: 22 * KiB,
  largestJsGzip: 55 * KiB,
  largestCssGzip: 15.4 * KiB,
}

const ROUTE_LIMITS = {
  '/': 147.7 * KiB, // 257 transport; 258: FileInput (146.0); 260: compressorjs (146.4)
  '/form': 187.5 * KiB, // 251 (183.4); 257 (184.2); 258: FileInput (185.4); 260 (185.9)
  // ВРЕМЕННО 148.5 → 150 (решение оператора, ход 10, 2026-10-11): /modals тянет
  // весь lib/form через панель настроек (bind статически несёт отправку, async,
  // конверт, редактор). Тексты ошибок F23 (+0.4) и очередь адреса F12 (+0.1)
  // дали 148.6. Вернуть 148.5 после F25 (docs/design/universal-demo-panel.md).
  // Ход 16: 150 → 155 — рантайм Kit 3 (см. REVISION выше). Ход 27: 155 → 160 —
  // три узла layout вместо одного (C2, см. REVISION у LIMITS). Ход 95: 160 → 165 —
  // поиск вариантов Select через matchesQuery paginate/search (R4, решение B): ядро fuzzy
  // (foldKey, взвешенный DL) едет в общий чанк примитивов, +1.4 на каждом маршруте;
  // /modals 161.0 > 160. По постоянному решению оператора — +5.
  // Ход 264: панель настроек хоста — универсальный DemoPanel (схема + ui):
  // факт 187.7 — цена того, что панель стала одним компонентом на все демо.
  '/modals': 188.2 * KiB, // 251 (179.5); 258: FileInput (183.8); 260 (184.3)
  // Пагинатор с живым источником, paginate/search и панелью фильтров. Ход 16 (решение
  // оператора): 138.6 → 196.5 = факт 191.5 + 5. Прежние «факт 120.3» и 138.6 были
  // замером БЕЗ страницы: узел записан в app.js как `~8` (серверные данные), и
  // разбор выбрасывал его (см. routeDictionary). Рост Kit 3 здесь ≈3.5, как у
  // остальных маршрутов; вес самой страницы — отдельная находка (docs/plan.md).
  '/paginator': 223.1 * KiB, // 251 (216.4); 257 (217.9); 258: FileInput (219.1); 260 (219.6)  // ход 264: панель на универсальном DemoPanel
  // C16 (решение оператора, ход 34: «прибавь размера»): маршруты без лимита
  // получили «факт + 5» по сборке хода 34 — 175.5 / 124.1 / 118.8 / 125.6.
  // Ход 109: + экран переноса схемы (SchemaPending, форма решений) — факт 180.8;
  // ленивый импорт не годится: без JS сервер отрисовал бы пустое место вместо экрана.
  // Ход 112: + закреплённые ошибки формы (pins) и смена источника в ядре пагинатора
  // (общее со списком БД) — факт 181.6 → 182.5.
  // Ход 185: модель `posts` в браузере (форма из модели) — факт 201.1, см. REVISION у LIMITS.
  '/db-demo': 220.2 * KiB, // 258: CopyInput (215.2), FileInput (216.0); 260 (216.4)  // ход 264: панель на универсальном DemoPanel
  '/cycle': 138.0 * KiB,
  '/spike': 132.6 * KiB,
  '/cards/[id]': 147.4 * KiB, // 251 (142.4); 257 (144.6); 258: FileInput (145.9); 260 (146.2)
  // Ход 224: конструктор полей — факт 169.9. Ход 236: хук `fieldSet` — факт 171.2.
  // Ход 237: чистка lib/form — факт 169.9.
  // Ход 263: замок шагов и сброс пишут состояние через lib/address (writer
  // тянет replaceState) — факт 182.3.
  '/fields': 182.9 * KiB, // 261 (181.1); form×step: бочка steps тянет паразита
  // Ход 261 (ревизия): универсальный хост шагов (режимы url/local/hybrid) + демо /steps.
  // Ход 262: /steps на универсальной демо-панели (факт 184.5).
  // Ход 264: у панели появилось зеркало внешних значений (url:false) — факт
  // 185.8.
  '/steps': 186.3 * KiB, // 261: 149.5; 262: DemoPanel вместо ручной панели
}

if (!existsSync(MANIFEST) || !existsSync(IMMUTABLE_ROOT)) {
  console.error('Нет клиентской сборки. Сначала запустите `npm run build`.')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const failures = []

function fmt(bytes) {
  return `${(bytes / KiB).toFixed(1)} KiB`
}

function failIf(label, value, limit) {
  const ok = value <= limit
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${fmt(value)} / ${fmt(limit)}`)
  if (!ok) failures.push(`${label}: ${fmt(value)} > ${fmt(limit)}`)
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, out)
    else if (/\.(js|css)$/.test(path)) out.push(path)
  }
  return out
}

function assetStats(file) {
  const buf = readFileSync(file)
  return { raw: buf.length, gzip: gzipSync(buf).length }
}

function immutableStats() {
  const files = walk(IMMUTABLE_ROOT).map((path) => {
    const rel = path.replace(`${CLIENT_ROOT}/`, '')
    return { file: rel, type: path.endsWith('.css') ? 'css' : 'js', ...assetStats(path) }
  })
  const sum = (type) => files.filter((f) => !type || f.type === type).reduce((n, f) => n + f.gzip, 0)
  const largest = (type) => files.filter((f) => f.type === type).sort((a, b) => b.gzip - a.gzip)[0]
  return { files, total: sum(), js: sum('js'), css: sum('css'), largestJs: largest('js'), largestCss: largest('css') }
}

function manifestKeyByName(name) {
  return Object.keys(manifest).find((key) => manifest[key]?.name === name)
}

function nodeKey(n) {
  const suffix = `/nodes/${n}.js`
  return Object.keys(manifest).find((key) => key.endsWith(suffix))
}

function resolveManifestKey(key) {
  if (manifest[key]) return key
  return Object.keys(manifest).find((candidate) => manifest[candidate]?.file === key)
}

function collectManifestFiles(keys, seenKeys = new Set(), files = new Set()) {
  for (const key of keys) {
    const resolved = resolveManifestKey(key)
    if (!resolved || seenKeys.has(resolved)) continue
    seenKeys.add(resolved)

    const entry = manifest[resolved]
    if (entry.file && /\.(js|css)$/.test(entry.file)) files.add(entry.file)
    for (const css of entry.css ?? []) files.add(css)
    collectManifestFiles(entry.imports ?? [], seenKeys, files)
  }
  return files
}

function routeDictionary() {
  if (!existsSync(GENERATED_APP)) return {}
  const source = readFileSync(GENERATED_APP, 'utf8')
  // Словарь Kit: `"/(site)/(app)/form": [лист, [layouts], [errors]]`. Разбор —
  // JSON после двух замен, а не регулярка по `[…]`: с группами (C2) значения
  // вложенные, и `\[([^\]]*)\]` обрезал их на первой `]`, теряя layouts.
  //   • `~n` — узел n с серверной загрузкой (в app.js это JS-выражение `~n`);
  //     без снятия `~` узел выпадает и /paginator, /db-demo мерятся без
  //     собственной страницы (так было до хода 16);
  //   • пропуски массива (`[,4]` — слот layout без файла) → `null`.
  const body = source.match(/export const dictionary = (\{[\s\S]*?\});/)?.[1]
  if (!body) return {}
  const dictionary = JSON.parse(
    body.replace(/~(\d+)/g, '$1').replace(/\[\s*,/g, '[null,').replace(/,\s*(?=[,\]])/g, ',null'),
  )
  const out = {}
  for (const [id, [leaf, layouts = []]] of Object.entries(dictionary)) {
    // Адрес маршрута — id без групп: `/(site)/(app)` → `/`. Вес — корень (0,
    // добавляет routeGzip) + layouts ветки + лист; узлы ошибок Kit грузит только
    // при ошибке — их нет в начальной загрузке, как не было и до групп.
    const url = id.replace(/\/\([^/]+\)/g, '') || '/'
    out[url] = [leaf, ...layouts].filter(Number.isFinite)
  }
  return out
}

function routeGzip(route, nodes) {
  const start = manifestKeyByName('entry/start')
  const app = manifestKeyByName('entry/app')
  if (!start || !app) throw new Error('Не найдены entry/start или entry/app в manifest')

  const requiredNodes = [...new Set([0, ...nodes])]
  const keys = [start, app, ...requiredNodes.map(nodeKey)]
  if (keys.some((key) => !key)) throw new Error(`Не найдены client nodes для маршрута ${route}`)

  const files = [...collectManifestFiles(keys)]
  const total = files.reduce((n, file) => n + assetStats(join(CLIENT_ROOT, file)).gzip, 0)
  return { total, files }
}

const stats = immutableStats()
console.log('Бюджеты клиентской сборки gzip')
failIf('все immutable-ресурсы', stats.total, LIMITS.allImmutableGzip)
failIf('весь JS', stats.js, LIMITS.allJsGzip)
failIf('весь CSS', stats.css, LIMITS.allCssGzip)
failIf(`самый большой JS (${stats.largestJs.file})`, stats.largestJs.gzip, LIMITS.largestJsGzip)
failIf(`самый большой CSS (${stats.largestCss.file})`, stats.largestCss.gzip, LIMITS.largestCssGzip)

const routes = routeDictionary()
console.log('\nБюджеты начальной загрузки маршрутов')
for (const [route, limit] of Object.entries(ROUTE_LIMITS)) {
  if (!routes[route]) {
    console.log(` FAIL ${route}: маршрут не найден в generated app`)
    failures.push(`${route}: маршрут не найден`)
    continue
  }
  const { total } = routeGzip(route, routes[route])
  failIf(`${route}`, total, limit)
}

console.log('\nКрупнейшие gzip-ресурсы')
for (const file of stats.files.sort((a, b) => b.gzip - a.gzip).slice(0, 8)) {
  console.log(`  ${fmt(file.gzip).padStart(9)}  ${file.file}`)
}

if (failures.length) {
  console.error(`\nБюджет превышен:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('\nбюджеты веса соблюдены')
