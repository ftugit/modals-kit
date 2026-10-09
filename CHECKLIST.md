# Чек-лист объединения v2 + v3

База итоговой ветки: **v3**, поскольку в ней работоспособная серверная половина SchemaOp, полноценные React/Solid-адаптеры, лучший корневой README, глубокий a11y-тест и встроенные стражи размера/импортов.

## Перенесено из v2

- [x] Исправленная HTML-проекция ограничений (`builtins.ts`, `field-types.ts`, `constraints.ts`): `step="any"`, корректные input-типы, required для color/range, дробный min.
- [x] Календарная проверка date/time/datetime-local вместо одной регулярки.
- [x] Полная реализация `v.step`: база min, даты/время, единицы и float-погрешность.
- [x] Проверка аргументов фабрик валидаторов.
- [x] Полный `BUILTIN_VALIDATORS`, включая `accept`, `maxSize`, `sameAs`.
- [x] Диагностика `spec.validator-invalid` и реальные лимиты help/pattern.
- [x] Сообщение для ошибки `step`.
- [x] 12 регрессионных unit-тестов исправлений ядра.
- [x] Глобальный фикс контраста темы и увеличение tap-target в SidebarFooter.
- [x] Полностраничный a11y smoke-suite и size-budget реальной сборки (в дополнение к глубокому suite/стражам v3).

## Сохранено из v3

- [x] Полные React и Solid адаптеры: live validation, async, continuation, schema operations, rows.
- [x] Серверный `expandFor` для динамических строк и runtime-полей.
- [x] Глубокий forms-a11y suite (темы, состояния, mobile, no-JS).
- [x] Автоматические form-size/import guards в `npm test`.
- [x] Корневой README и документация, не удаляющие API модалок.

## Исправлено дополнительно

- [x] **Критично:** `submissionId` ротируется после `committed`/`unknown` во всех трёх адаптерах. Новая осмысленная отправка больше не получает кэш предыдущей.
- [x] Политика `SubmitMachine.queue` теперь действительно ждёт слот через `acquire()`, а не ставит noop и не теряет отправку. Все адаптеры используют новый путь.
- [x] Имя intent-поля берётся из `policy.envelopeKeys.intent` в Svelte, React и Solid; удалён хардкод `intent`.
- [x] Solid `formProps()` сам передаёт `ref`, поэтому live/async-проверки не зависят от недокументированного ручного `setFormEl`.
- [x] Переполнение динамической схемы в `expandFor` преобразуется в контролируемый HTTP 413 вместо HTTP 500.
- [x] Серверный `onErrors` получает фактический intent вместо всегда `submit`.
- [x] Ошибки `after()` больше не исчезают: возвращаются в `Result.warnings`.
- [x] Пользовательский порядок серверных слоёв проверяется: нельзя удалить обязательные `bodyLayer`/`namesLayer` и получить падение через `ctx.form!`.
- [x] Исправлена опечатка/типизация intent-пропсов при переносе policy-driven имени.

## Проверки

- [x] `npm test`: unit + tooling guards.
- [x] `npm run check`: TypeScript/Svelte diagnostics.
- [x] Browser-suite на production preview: regressions 28, modals 31, shell 7, forms 29 и forms-a11y 12 проверок.
- [ ] Отдельные runtime-тесты React/Solid адаптеров — остаются рекомендуемым следующим усилением.

## Осознанно не переносилось

- TanStack-примеры v2 не копировались: они используют более слабые «тонкие» адаптеры и дублируют React/Solid решение v3. Полноценные адаптеры v3 оставлены каноническими.
- Корневой README v2 не переносился, поскольку он удалял документацию модалок.
- `u_*` runtime-поля пока сохраняют модель v3 без серверных валидаторов. Для production их следует поднимать из доверенного `DescriptionSource/UserFieldStore`, а не принимать правила от клиента.
