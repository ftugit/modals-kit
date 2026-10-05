// Чужие службы: нормализация ДО обработчика.
//
// Инструкция описывает только формат службы: как достать код, поле и текст,
// как назвать поле по-нашему. Разработчик получает уже наши имена — иначе
// ему пришлось бы разбирать чужой формат второй раз.
//
//     сырой ответ → инструкция → единый массив (ФАКТ) → обработчик → показ
import { keep } from './keep'
import type { FormError } from './result'
import { stableId } from './result'
import { safeObject } from './types'

/** Что инструкция вытащила из тела. Ещё не наш словарь имён. */
export interface RawError {
  code?: string
  field?: string
  message?: string
}

/** Инструкция нормализации ответа внешней службы. */
export interface ErrorInstruction {
  readonly id: string
  /** Сырой ответ → плоский список. Вернула `null` — формат не её. */
  parse(input: { status: number; body: unknown }): RawError[] | null
  /** Имя поля службы → наше имя. */
  readonly aliases?: Readonly<Record<string, string>>
  /** Код службы → наше поле, когда поле в теле не названо. */
  readonly codeAliases?: Readonly<Record<string, string>>
  /** Код службы → человекочитаемый текст. */
  readonly messages?: Readonly<Record<string, string>>
}

/** Реестр инструкций нормализации внешних ошибок. */
export class InstructionRegistry {
  #byId = new Map<string, ErrorInstruction>()
  register(i: ErrorInstruction): this {
    keep(this.#byId, i.id, i, 'инструкция разбора')
    return this
  }
  get(id: string): ErrorInstruction | undefined { return this.#byId.get(id) }
  ids(): readonly string[] { return [...this.#byId.keys()] }
}

/** Вход normalizeService. */
export interface NormalizeInput {
  status: number
  body: unknown
  instruction: ErrorInstruction
}

/**
 * Ответ службы → наши ошибки. Нормализованная ошибка хранит `source`:
 * без него «увести в канал именно эту службу» или «не показывать вот этот
 * код» пришлось бы делать, разбирая тело заново.
 */
export function normalizeService(input: NormalizeInput): FormError[] {
  const { status, body, instruction } = input
  const raws = instruction.parse({ status, body })

  if (!raws) {
    // формат не распознан — это не повод промолчать
    const code = `service.${status}`
    return [{
      id: stableId({ code }), code,
      message: instruction.messages?.[code] ?? 'Служба вернула неожиданный ответ',
      origin: 'external', source: body,
    }]
  }

  const aliases = instruction.aliases ?? safeObject<string>()
  const codeAliases = instruction.codeAliases ?? safeObject<string>()

  return raws.map((r) => {
    const code = r.code ?? `service.${status}`
    // имя поля службы → наше; не нашлось — ошибка просто общая
    const path = (r.field ? aliases[r.field] : undefined) ?? codeAliases[code]
    return {
      id: stableId({ path, code: `external.${code}`, params: { field: r.field } }),
      code: `external.${code}`,
      message: instruction.messages?.[code] ?? r.message,
      path,
      origin: 'external' as const,
      source: r,
    }
  })
}
