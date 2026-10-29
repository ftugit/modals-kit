// Однократная настройка проекта. Хук приложения существует только затем,
// чтобы не повторять ЭТО на каждой форме.
import { report } from '#hooks/app-errors.svelte.js'
import { createConfig } from '#lib/form/svelte/index.js'
import './extend'                       // регистрация своего типа и правил
import { checks } from './extend'
import { ru } from './messages.ru'
import { resolve } from './resolve'

// Транспорта по умолчанию здесь НЕТ намеренно: адрес отправки — свойство
// формы, а не проекта. Встраиваемая форма получает его от `bindComponentForm`
// (текущий адрес + конверт `__form_id`), страничный экшен — от `bind`
// с явным `kitActionTransport('?/имя')`. Общий транспорт «куда-нибудь» —
// это скрытая ошибка: забытый адрес выглядит как рабочий.

export const forms = createConfig({
  // Соответствие «представление → компонент приложения». Функция, не таблица.
  resolve,
  messages: ru,
  actionBase: '/form',
  live: 'after-touched',
  parallel: 'block',
  // Q1: системные сбои формы стекаются в единый канал приложения (показ не трогает).
  onError: report,
})

/** Асинхронные проверки и русский UI-словарь ошибок форм. */
export { checks, ru }

/**
 * Та же настройка с подменённой политикой разметки: другие идентификаторы
 * полей и проверка на каждом вводе. Умолчания библиотеки не трогаются.
 */
export const formsCustomUi = createConfig({
  resolve,
  messages: ru,
  actionBase: '/form',
  live: 'after-touched',
  parallel: 'block',
  onError: report,
  ui: {
    fieldId: (formId, name) => `fld_${formId}__${name}`,
    shouldValidate: ({ event }) => event === 'input',
  },
})
