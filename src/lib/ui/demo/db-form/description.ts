// Изоморфное описание: его читают и страница (bind), и сервер
// (createFormHandler). Разъезда «клиент проверяет одно, сервер другое» здесь
// быть не может — валидация одна на оба пути.
import { defineForm, field, v } from '$lib/form'

/** Запись в таблицу демо. `title` — единственное, что решает сервер. */
export const dbCreate = defineForm({
  // Имя формы попадает в `__form_instance`, а его сверяет INSTANCE_RE
  // (envelope.ts): `[a-z][a-z0-9_-]{0,31}:…` — точек и заглавных там нет. Форма с
  // id вида `db-demo.create` роняет каждую отправку на 400 envelope.invalid,
  // поэтому id только в этом алфавите.
  id: 'db_demo_create',
  revision: 1,
  // Единственное действие = `submit`: нативный путь маршрутизируется именем
  //  form-экшена (`?/create`), а не интентом, и сервер обязан принять именно его.
  actions: [{ id: 'submit', label: 'Добавить', validate: 'full' }],
  fields: {
    title: field.text({
      label: 'заголовок (минимум 3 символа)',
      placeholder: 'например: заметка из превью',
      validate: [v.required(), v.minLength(3)],
    }),
  },
})

/**
 * Удаление по id. Поле видимое и текстовое: id строки таблицы показан целиком,
 * его можно скопировать. Скрытой парой делать нечего — тогда страница
 * заводит собственный путь передачи значения мимо связки.
 */
export const dbRemove = defineForm({
  id: 'db_demo_remove',
  revision: 1,
  actions: [{ id: 'submit', label: 'удалить', validate: 'full' }],
  fields: {
    ids: field.text({
      label: 'id записей (через запятую)',
      placeholder: 'например: 0f9c1a2e',
      validate: [v.required()],
    }),
  },
})
