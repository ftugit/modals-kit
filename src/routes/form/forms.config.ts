// Однократная настройка проекта. Хук приложения существует только затем,
// чтобы не повторять ЭТО на каждой форме.
import { report } from '$lib/app-errors.svelte'
import { createConfig } from '$lib/form/svelte'
import type { Transport } from '$lib/form'
import './extend'                       // регистрация своего типа и правил
import { checks } from './extend'
import CheckboxField from './ui/CheckboxField.svelte'
import RatingField from './ui/RatingField.svelte'
import SelectField from './ui/SelectField.svelte'
import PasswordField from './ui/PasswordField.svelte'
import TextField from './ui/TextField.svelte'
import TextareaField from './ui/TextareaField.svelte'

/** Транспорт: единственное место, где происходит сетевой вызов. */
export const httpTransport: Transport = async (req) => {
  try {
    const res = await fetch('/form/submit', {
      method: 'POST', body: req.data, headers: { accept: 'application/json' },
      signal: req.signal,
    })
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json'))
      return { kind: 'network', code: 'network.failed', detail: `не-JSON ответ: ${ct}` }
    return { kind: 'result', result: await res.json() }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { kind: 'abort', reason: 'aborted' }
    return { kind: 'network', code: 'network.failed', detail: String(e) }
  }
}

const resolve = (f: { input: string }) => {
  switch (f.input) {
    case 'password': return PasswordField
    case 'rating': return RatingField          // свой тип — такой же гражданин
    case 'textarea': return TextareaField
    case 'select': case 'radio': return SelectField
    case 'checkbox': return CheckboxField
    default: return TextField
  }
}

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
