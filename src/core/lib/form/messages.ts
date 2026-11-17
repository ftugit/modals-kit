// Messages are NOT hardcoded in validators: validators emit code + params.
import { defaultPolicy } from './policy'

/** Message dictionary: string template or function of params. */
export type MessageDictionary = Record<string, string | ((p: Record<string, unknown>) => string)>

/** Default English messages for built-in error codes. */
export const en: MessageDictionary = {
  required: 'Required field',
  email: 'Enter a valid email address',
  url: 'Enter a valid URL',
  pattern: 'Invalid format',
  minLength: (p) => `At least ${p['min']} characters`,
  maxLength: (p) => `At most ${p['max']} characters`,
  minValue: (p) => `Must be at least ${p['min']}`,
  maxValue: (p) => `Must be at most ${p['max']}`,
  minCount: (p) => `Select at least ${p['min']}`,
  maxCount: (p) => `Select at most ${p['max']}`,
  minDate: (p) => `Not earlier than ${p['min']}`,
  maxDate: (p) => `Not later than ${p['max']}`,
  integer: 'Enter an integer',
  step: (p) => `Step ${p['step']}`,
  multipleOf: (p) => `Step ${p['step']}`,
  oneOf: 'Select a valid option',
  sameAs: 'Values do not match',
  notAbove: 'Must not exceed upper bound ({other})',
  notBelow: 'Must not be below lower bound ({other})',
  noOverlap: (p) =>
    Number(p['count']) > 1
      ? 'These values overlap with the related field'
      : 'This value overlaps with the related field',
  unique: 'This value is already taken',
  check: 'Value failed validation check',
  reference: 'Referenced record not found',
  referenced: 'Cannot delete: record is referenced elsewhere',
  invalid: 'Invalid value',
  accept: (p) => `File ${p['name'] ?? ''} has an unsupported type`.replace('  ', ' '),
  maxSize: (p) => `File ${p['name'] ?? ''} exceeds ${Math.ceil(Number(p['bytes']) / 1024)} KB`.replace('  ', ' '),
  'form.budget': (p) => {
    const mb = (n: unknown) => Math.round((Number(n) / (1024 * 1024)) * 10) / 10
    return `Form exceeds limit: ${mb(p['total'])} MB of ${mb(p['max'])} MB allowed`
  },
  strength: (p) => {
    const notes = (p['notes'] as string[] | undefined)?.filter(Boolean) ?? []
    const head = `Password is ${String(p['got'] ?? 'weak')}, expected ${String(p['need'] ?? 'strong')}`
    return notes.length ? `${head}: ${notes.join(', ')}` : head
  },
  'link.blocked': '"{field}" cannot be used with {blockers}: {reason}',
  'link.message': '{text}',
  'type.number': 'Enter a number',
  'type.date': 'Enter a date',
  'type.time': 'Enter a time',
  'type.datetime': 'Enter date and time',
  'form.stale': 'Form is outdated: fields changed',
  'network.failed': 'Outcome is unknown. Do not resubmit',
  'envelope.invalid': 'Request rejected',
  'envelope.missing': 'Request rejected: missing envelope',
  'envelope.unknown-intent': 'Unknown action',
  'envelope.instance-mismatch': 'Request rejected',
  'envelope.form-mismatch': 'Request rejected',
  'request.unexpected-field': 'Unexpected field in request',
  'request.duplicate': 'Duplicate field value',
  'handler.failed': 'Operation failed',
  'submission.in-flight': 'Submission is already in progress',
  'success-not-acknowledged': 'Operation was not acknowledged',
  'interceptor.failed': 'Internal processing error',
  'after.failed': 'Action succeeded, but post-task failed',
  'check.failed': 'Validation check failed. Try again',
  'value.incompatible': 'Value is incompatible with updated field',
  'method.not-allowed': 'Method not allowed',
  'origin.rejected': 'Cross-origin request rejected',
  'body.unsupported-type': 'Unsupported content type',
  'body.too-large': 'Request body too large',
  'body.too-many-keys': 'Too many fields in request',
  'request.too-many': 'Too many values for field',
  'request.timeout': 'Request timed out. Try again',
  'kit.not-list': 'Invalid field list specification',
  'type.fields': 'Invalid field set',
  'kit.too-many-fields': (p) => `${p['count']} fields exceed maximum ${p['max']}`,
  'kit.field-shape': 'Invalid field specification',
  'kit.unknown-kind': 'Unknown field kind',
  'kit.rule-not-allowed': 'Rule is not allowed for this field kind',
  'kit.rule-duplicate': 'Duplicate rule',
  'kit.arg-type': 'Rule argument must be a number',
  'kit.arg-missing': 'Rule argument is required',
  'kit.spec': 'Invalid field rule configuration',
  'rate.limited': (p) => {
    const s = Math.ceil(Number(p['retryAfterMs'] ?? 0) / 1000)
    return s > 0 ? `Too many attempts. Try again in ${s}s` : 'Too many attempts. Try again later'
  },
}

/**
 * Priority (F56): validator `.message()` → per dictionary `field:code` then `code`;
 * dictionaries ordered form → app → package → raw code.
 */
export function makeRenderer(
  dicts: readonly (MessageDictionary | undefined)[],
  interpolate: (t: string, p: Record<string, unknown>) => string = defaultPolicy.interpolate,
) {
  const chain = dicts.filter(Boolean) as MessageDictionary[]
  return (
    code: string, params: Record<string, unknown> = {},
    at: { path?: string; template?: string } = {},
  ): string => {
    if (at.template !== undefined) return interpolate(at.template, params)
    const keys = at.path ? [`${at.path}:${code}`, code] : [code]
    for (const d of chain) {
      for (const key of keys) {
        const t = d[key]
        if (typeof t === 'function') return t(params)
        if (typeof t === 'string') return interpolate(t, params)
      }
    }
    return code
  }
}
