import { en, makeRenderer, type MessageDictionary } from './messages'

/**
 * Shared dictionary priority (F55): **form → app → package (`en`)**.
 * Client (`bind`) passes `createConfig({ messages })` as `app` (e.g. `ru` in UI);
 * server (`createFormHandler`) passes optional `HandlerOptions.messages` and falls back to `en`.
 */
export function formRenderer(
  form: MessageDictionary | undefined,
  app: MessageDictionary | undefined,
  interpolate?: (t: string, p: Record<string, unknown>) => string,
) {
  return makeRenderer([form, app, en], interpolate)
}
