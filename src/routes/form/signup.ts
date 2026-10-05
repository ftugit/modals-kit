// Изоморфное описание: его импортируют и страница, и серверное действие.
// Ноль UI, ноль HTTP, ноль Svelte.
import { defineForm, field, v } from '$lib/form'
import { emailTaken, inn, luhn } from './extend'

/**
 * Кардинальность ошибок — свойство ОПИСАНИЯ: его обязаны видеть обе стороны.
 * Настройка на стороне адаптера развела бы пути — сервер о ней не знает.
 */
function make(cardinality: 'first' | 'all') {
  return defineForm({
    id: 'signup',
    revision: 1,
    cardinality,
    actions: [
      { id: 'submit', label: 'Создать аккаунт', validate: 'full' },
      // Действие снимает ВИД ограничения, а не имя правила.
      { id: 'save-draft', label: 'Сохранить черновик', validate: 'partial', relax: ['required'] },
      // операции над набором полей — такие же действия, но без проверки
      { id: 'add-row', label: '+ позиция', validate: 'none', sideEffect: 'mutate-schema' },
      { id: 'remove-row', validate: 'none', sideEffect: 'mutate-schema' },
      { id: 'add-field', label: '+ поле', validate: 'none', sideEffect: 'mutate-schema' },
    ],
    fields: {
      email: field.email({
        label: 'Почта',
        placeholder: 'вы@почта.рф',
        help: 'Попробуйте taken@example.com — проверка уходит на сервер',
        validate: [v.required(), v.maxLength(320), emailTaken()],
      }),
      // Два правила нарушаются одновременно — на этом поле видна разница
      // между «первая ошибка» и «все ошибки».
      password: field.password({
        label: 'Пароль',
        help: 'Не короче десяти символов и не слабее уровня good',
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
      about: field.textarea({ label: 'О себе', validate: [v.maxLength(200)] }),
      // повторяемая группа: ключ строки стабилен, индекс — производное
      'items.r1.sku': field.text({ label: 'Артикул', validate: [v.maxLength(16)] }),
      'items.r1.qty': field.number({ label: 'Количество', validate: [v.minValue(1), v.maxValue(99)] }),
      agree: field.checkbox({ label: 'Согласен с условиями', validate: [v.required()] }),
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
export function resolveDescription(formId: unknown, specVersion: unknown) {
  if (formId !== 'signup') return undefined
  return Number(specVersion) === SPEC_ALL ? signupAll : signup
}
