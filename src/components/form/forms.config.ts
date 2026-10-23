// Однократная настройка проекта. Хук приложения существует только затем,
// чтобы не повторять ЭТО на каждой форме.
import { report } from '#hooks/app-errors.svelte.js'
import { createConfig } from '#lib/form/svelte/index.js'
import type { Transport } from '#lib/form/index.js'
import { jsonTransport } from './transport'
import './extend'                       // регистрация своего типа и правил
import { checks } from './extend'
import { resolve } from './resolve'

/**
 * Транспорт: единственное место, где происходит сетевой вызов.
 * Ответ, не похожий на `Result` (отказ CSRF у фреймворка, HTML ошибки,
 * не-JSON), переводится здесь в ошибку показа — иначе пользователь видит
 * «http.403» вместо причины.
 */
export const httpTransport: Transport = jsonTransport('/form/submit')

export const forms = createConfig({
  // Соответствие «представление → компонент приложения». Функция, не таблица.
  resolve,
  transport: httpTransport,
  actionBase: '/form',
  live: 'after-touched',
  parallel: 'block',
  // Q1: системные сбои формы стекаются в единый канал приложения (показ не трогает).
  onError: report,
})

/** Асинхронные проверки передаются связке: в браузере — с подавлением. */
export { checks }

/**
 * Та же настройка с подменённой политикой разметки: другие идентификаторы
 * полей и проверка на каждом вводе. Умолчания библиотеки не трогаются.
 */
export const formsCustomUi = createConfig({
  resolve,
  transport: httpTransport,
  actionBase: '/form',
  live: 'after-touched',
  parallel: 'block',
  onError: report,
  ui: {
    fieldId: (formId, name) => `fld_${formId}__${name}`,
    shouldValidate: ({ event }) => event === 'input',
  },
})
