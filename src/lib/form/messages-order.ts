import { makeRenderer, ru, type MessageDictionary } from './messages'

/**
 * Один порядок словарей на клиенте и на сервере (F55): **форма → приложение →
 * пакет** — как обещают README и `makeRenderer`. Словарь формы конкретнее
 * словаря приложения и поэтому сильнее: приложение задаёт тексты «по умолчанию
 * для всех форм», форма — свои. Раньше клиент (`bind`) и сервер
 * (`createFormHandler`) собирали цепочку каждый сам и оба ставили приложение
 * впереди формы.
 *
 * «Приложение» на клиенте — `createConfig({ messages })`, на сервере —
 * `createFormHandler({ messages })`; уровень поля/правила (`DisableRule.message`)
 * разрешается раньше, в самом правиле.
 */
export function formRenderer(
  form: MessageDictionary | undefined,
  app: MessageDictionary | undefined,
  interpolate?: (t: string, p: Record<string, unknown>) => string,
) {
  return makeRenderer([form, app, ru], interpolate)
}
