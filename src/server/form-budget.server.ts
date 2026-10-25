// Потолок тела формы — из окружения развёртывания, а не из описания формы.
//
// Форма вправе объявить бюджет МЕНЬШЕ (`defineForm({ limits: { budget } })`):
// число больше потолка молча игнорируется. Сам потолок живёт в env, потому что
// его задаёт платформа (Vercel 4.5 МБ, Cloudflare 100 МБ, свой Node —
// `client_max_body_size`); ядро `#lib/form` env не читает — оно лежит ниже
// `#hooks`/`#server` и сети не делает.
import { FORM_BODY_LIMIT } from '$app/env/private'
import { FILE_BUDGET_RESERVE } from '#lib/form/index.js'
import { DEFAULT_LIMITS, type Limits } from '#lib/form/server.js'

/** Потолок тела запроса, байт: env развёртывания, иначе безопасное умолчание. */
export function bodyBudget(): number {
  return FORM_BODY_LIMIT ?? DEFAULT_LIMITS.maxBytes
}

/** Бюджет ВСЕХ файлов формы: потолок тела минус резерв на текст. */
export function filesBudget(budget: number = bodyBudget()): number {
  return Math.max(0, budget - FILE_BUDGET_RESERVE)
}

/**
 * Пределы приёма от окружения: тело — потолок, один файл — бюджет файлов.
 * Частные пределы регистрации (`limits` в `registerComponentForm`) могут только
 * уменьшить оба числа, но не поднять: платформа всё равно откажет раньше.
 */
export function envLimits(patch: Partial<Limits> = {}): Limits {
  const budget = bodyBudget()
  const files = filesBudget(budget)
  return {
    ...DEFAULT_LIMITS,
    ...patch,
    maxBytes: Math.min(patch.maxBytes ?? budget, budget),
    maxFileSize: Math.min(patch.maxFileSize ?? files, files),
  }
}
