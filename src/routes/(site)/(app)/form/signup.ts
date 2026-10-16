// Изоморфное описание: его импортируют и страница, и серверное действие.
// Ноль UI, ноль HTTP, ноль Svelte.
import { defineForm, field, v } from '#lib/form/index.js'
import { emailTaken, inn, luhn } from '#lib/components/form/extend.js'

/**
 * Кардинальность ошибок — свойство ОПИСАНИЯ: его обязаны видеть обе стороны.
 * Настройка на стороне адаптера развела бы пути — сервер о ней не знает.
 */
/** Ответы, которые умеет изобразить демо-сервер (`handle.ts`). */
export const ANSWERS = ['accept', 'redirect', 'unknown'] as const
export type Answer = (typeof ANSWERS)[number]

function make(cardinality: 'first' | 'all') {
  return defineForm({
    id: 'signup',
    revision: 1,
    cardinality,
    actions: [
      { id: 'submit', label: 'Создать аккаунт', validate: 'full' },
      // Действие снимает ВИД ограничения, а не имя правила.
      { id: 'save-draft', label: 'Сохранить черновик', validate: 'partial', relax: ['required'] },
      // Проверяет только перечисленные поля: остальные не трогаются ни в браузере,
      // ни на сервере. Без JS кнопка получает formnovalidate — иначе браузер
      // потребовал бы и пароль.
      { id: 'check-contacts', label: 'Проверить контакты', validate: 'full', subset: ['email', 'phone'] },
    ],
    fields: {
      email: field.email({
        label: 'Почта',
        placeholder: 'вы@почта.рф',
        help: 'Попробуйте taken@example.com — проверка уходит на сервер',
        // type="email" защищает только нативный путь. При fetch-перехвате
        // форма использует novalidate, поэтому формат обязан проверять core.
        validate: [v.required(), v.email('html5'), v.maxLength(320), emailTaken()],
        messages: { unique: 'Этот адрес уже занят' },
      }),
      // Два правила нарушаются одновременно — на этом поле видна разница
      // между «первая ошибка» и «все ошибки». Шаблона нет принципиально:
      // он проверяет наличие символов, а не стойкость, и мешает ставить
      // знаки. Вместо него — оценка сложности; в разметку уходит только
      // нижняя граница длины, и её же сообщает первое правило.
      password: field.password({
        label: 'Пароль',
        variant: 'strength',
        help: 'Не короче десяти символов и достаточно стойкий: оценка вместо шаблона',
        validate: [v.required(), v.minLength(10), v.strength('good')],
      }),
      // sameAs не имеет вида ограничения: браузер не умеет сравнивать поля.
      // Поэтому проверяет сервер — и это работает без скрипта.
      confirm: field.password({
        label: 'Повторите пароль',
        help: 'Проверяет сервер: вида ограничения для сравнения полей нет',
        validate: [v.required(), v.sameAs('password')],
      }),
      age: field.number({
        label: 'Возраст',
        help: 'Полных лет',
        validate: [v.required(), v.minValue(18), v.maxValue(120)],
      }),
      // СВОЙ ТИП ЗНАЧЕНИЯ, зарегистрированный приложением.
      rating: field.rating({
        label: 'Оценка',
        help: 'Свой тип значения: зарегистрирован приложением, не библиотекой',
        defaultValue: 3,
        validate: [v.minValue(1), v.maxValue(5), v.step(1)],
      }),
      // СВОЁ ПРАВИЛО с описанием: атрибут выводится.
      tax_id: field.text({
        label: 'ИНН',
        help: 'Своё правило с описанием: шаблон уходит в разметку',
        validate: [inn()],
      }),
      // СВОЁ ПРАВИЛО без описания: атрибута нет, причина названа в отчёте.
      card: field.text({
        label: 'Номер карты',
        help: 'Своё правило без описания: проверяется, но атрибута не даёт',
        validate: [luhn()],
      }),
      // СВОЙ ТИП №2: телефон одной строкой (+79991234567). Код страны внутри поля
      // появляется после оживления; без JS — номер целиком, сервер его нормализует.
      phone: field.phone({
        label: 'Телефон',
        placeholder: '+7 999 123-45-67',
        help: 'Необязательно: для срочной связи',
        messages: { 'type.phone': 'Введите номер полностью, с кодом страны: +7 999 123-45-67' },
      }),
      about: field.textarea({ label: 'О себе', variant: 'auto', validate: [v.maxLength(200)] }),
      // Представления со своими примитивами: код (ячейки), множественный выбор,
      // переключатель. Число ячеек кода берётся из правила длины.
      invite: field.otp({
        label: 'Код приглашения',
        help: 'Необязательно: шесть цифр из письма',
        validate: [v.maxLength(6), v.pattern({ source: '\\d{6}' })],
      }),
      topics: field.multiselect({
        label: 'Интересы',
        options: [
          { value: 'news', label: 'Новости' },
          { value: 'tips', label: 'Советы' },
          { value: 'events', label: 'События' },
        ],
      }),
      digest: field.switch({ label: 'Присылать дайджест на почту' }),
      agree: field.checkbox({ label: 'Согласен с условиями', validate: [v.required()] }),

      // ── Ещё поля: остальные встроенные представления и правила ──────────
      site: field.url({
        label: 'Сайт',
        placeholder: 'https://example.com',
        help: 'Адрес целиком, со схемой https://',
        validate: [v.url(), v.maxLength(200)],
      }),
      // Период: обе границы необязательны, «по» не раньше «с» — сравнение полей
      // делает только ядро, у браузера такого атрибута нет.
      from_date: field.date({
        label: 'Доступ с',
        help: 'Не раньше 1 января 2026',
        validate: [v.minDate('2026-01-01')],
      }),
      to_date: field.date({
        label: 'Доступ по',
        help: 'Не позже конца 2027 и не раньше даты «с»',
        validate: [v.maxDate('2027-12-31'), v.notBelow('from_date')],
      }),
      call_at: field.time({ label: 'Удобное время звонка' }),
      meet_at: field['datetime-local']({ label: 'Встреча' }),
      letters: field.range({
        label: 'Писем в месяц',
        defaultValue: 4,
        validate: [v.minValue(0), v.maxValue(30), v.step(1)],
      }),
      accent: field.color({ label: 'Цвет профиля', defaultValue: '#2563eb' }),
      // Видимость по значению другого поля: условие — данные, поэтому сервер
      // считает его сам. Скрытое поле не проверяется и не требуется.
      from_company: field.checkbox({ label: 'Я от компании' }),
      company: field.text({
        label: 'Компания',
        visibleWhen: { field: 'from_company', equals: true },
        validate: [v.required(), v.maxLength(120)],
      }),
      docs: field.files({
        label: 'Карточка компании',
        help: 'От одного до трёх файлов: картинка или PDF до 512 КБ',
        visibleWhen: { field: 'from_company', equals: true },
        validate: [v.minCount(1), v.maxCount(3), v.accept(['image/*', 'application/pdf']), v.maxSize(512 * 1024)],
        messages: { minCount: 'Прикрепите хотя бы один файл', maxCount: 'Не больше трёх файлов' },
      }),
      // Скрытое поле: какой ответ изобразит сервер (панель «Ответ сервера»).
      // Только для демо — настоящая форма не даёт клиенту выбирать исход.
      // Правила нет: незнакомое или пустое значение сервер читает как «принято».
      answer: field.hidden({ defaultValue: 'accept' }),
    },
  })
}

export const signup = make('first')
export const signupAll = make('all')

export const SPEC_FIRST = 1
export const SPEC_ALL = 2

/**
 * Источник описания. Принимает версию ИЗ КОНВЕРТА, а не «самую свежую»:
 * страница, открытая до переключения, получит своё описание.
 */
export function resolveDescription(specVersion: number | undefined) {
  return specVersion === SPEC_ALL ? signupAll : signup
}
