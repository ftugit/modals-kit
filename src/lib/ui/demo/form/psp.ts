// Чужая служба: формат ответа её собственный, библиотека о нём не знает.
import { defaultRegistry, normalizeService, type ErrorInstruction } from '$lib/form'

/**
 * Служба отвечает так — ни одна поддерживаемая форма такое не разберёт:
 *
 *   { "outcome": "REJECTED",
 *     "payload": { "violations": [
 *        { "attr": "pan",           "rule": "LUHN_FAILED",    "humanText": "…" },
 *        { "attr": "payer.contact", "rule": "BAD_CONTACT",    "humanText": "…" },
 *        { "attr": null,            "rule": "LIMIT_EXCEEDED", "humanText": "…" } ] } }
 */
export const pspInstruction: ErrorInstruction = {
  id: 'psp',
  parse: ({ body }) => {
    const b = body as { outcome?: string; payload?: { violations?: unknown[] } } | null
    if (!b || typeof b !== 'object') return null
    if (b.outcome === 'ACCEPTED') return []
    const list = b.payload?.violations
    if (!Array.isArray(list)) return null
    return list.map((raw) => {
      const r = raw as Record<string, unknown>
      return {
        code: typeof r['rule'] === 'string' ? r['rule'] : undefined,
        field: typeof r['attr'] === 'string' ? r['attr'] : undefined,
        message: typeof r['humanText'] === 'string' ? r['humanText'] : undefined,
      }
    })
  },
  // имя поля службы → наше
  aliases: { pan: 'card', 'payer.contact': 'email', total: 'age' },
  // код → поле, когда поле не названо
  codeAliases: { AMOUNT_TOO_BIG: 'age' },
  messages: {
    LUHN_FAILED: 'Банк не принял номер карты',
    BAD_CONTACT: 'Банк не принял адрес почты',
    LIMIT_EXCEEDED: 'Превышен лимит операции. Попробуйте позже',
  },
}

defaultRegistry.registerInstruction(pspInstruction)

export const PSP_SAMPLES: Record<string, { status: number; body: unknown }> = {
  'поле и код известны': {
    status: 200,
    body: { outcome: 'REJECTED', payload: { violations: [
      { attr: 'pan', rule: 'LUHN_FAILED', humanText: 'Card rejected by issuer' },
      { attr: 'payer.contact', rule: 'BAD_CONTACT', humanText: 'Contact rejected' },
    ] } },
  },
  'поля нет, код известен': {
    status: 200,
    body: { outcome: 'REJECTED', payload: { violations: [
      { attr: null, rule: 'AMOUNT_TOO_BIG', humanText: 'Too much' },
    ] } },
  },
  'ни поля, ни соответствия': {
    status: 200,
    body: { outcome: 'REJECTED', payload: { violations: [
      { attr: 'unknown_attr', rule: 'WEIRD_THING', humanText: 'Нечто от службы' },
      { attr: null, rule: 'LIMIT_EXCEEDED', humanText: 'Daily limit exceeded' },
    ] } },
  },
  'формат не распознан': { status: 502, body: '<html>Bad Gateway</html>' },
}

export const normalizePsp = (sample: { status: number; body: unknown }) =>
  normalizeService({ ...sample, instruction: pspInstruction })
