// Потолок тела формы — из окружения развёртывания, а не из описания формы.
//
// Форма вправе объявить бюджет МЕНЬШЕ (`defineForm({ budget })`):
// число больше потолка молча игнорируется (`min(объявленный, env)`). Сам потолок
// живёт в env, потому что его задаёт платформа (Vercel 4.5 МБ, Cloudflare 100 МБ,
// свой Node — `client_max_body_size`); ядро `#lib/form` env не читает.
import { FORM_BODY_LIMIT } from '$app/env/private'
import { FILE_BUDGET_RESERVE } from '#lib/form/index.js'
import { DEFAULT_LIMITS, type Limits } from '#lib/form/server.js'

/** Потолок тела запроса, байт: env развёртывания, иначе безопасное умолчание. */
export function bodyBudget(): number {
  return FORM_BODY_LIMIT ?? DEFAULT_LIMITS.budget
}

/** Бюджет ВСЕХ файлов формы: потолок тела минус резерв на текст. */
export function filesBudget(budget: number = bodyBudget()): number {
  return Math.max(0, budget - FILE_BUDGET_RESERVE)
}

/**
 * Пределы приёма от окружения: задаёт потолок `budget` из env, не затирая
 * изоморфные `limits` (`maxKeys`, `maxValuesPerKey`, `timeoutMs`), объявленные в `defineForm`.
 */
export function envLimits(patch: Partial<Limits> = {}): Partial<Limits> & { readonly budget: number } {
  const budget = bodyBudget()
  return {
    ...patch,
    budget: Math.min(patch.budget ?? budget, budget),
  }
}
