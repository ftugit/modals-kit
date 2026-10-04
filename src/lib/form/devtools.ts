// Отчёт для разработки. Он не записан в библиотеке руками: всё строится
// обходом реестра и описания, поэтому разойтись с поведением не может.
import type { FormDescription } from './describe'
import type { ConstraintKind } from './constraints'
import type { FormError } from './result'
import type { Outcome } from './result'

export interface AttrRow {
  readonly field: string
  readonly input: string
  readonly constraints: readonly ConstraintKind[]
  readonly attrs: Record<string, unknown>
  readonly skipped: readonly { kind: ConstraintKind; why: string }[]
}

export interface MatrixRow {
  readonly kind: string
  /** Виды ограничений, которые тип умеет проецировать или хотя бы принимает. */
  readonly accepts: readonly ConstraintKind[]
}

export interface SubmitLogEntry {
  readonly submissionId: string
  readonly at: number
  readonly intent: string
  readonly outcome: Outcome
  readonly status: number
  readonly ms: number
  readonly facts: number
  readonly shown: number
}

export interface Health {
  /** Доля ограничений, давших хотя бы один атрибут. Падает — словарь перестаёт справляться. */
  readonly projected: number
  readonly opaque: number
  readonly unknownKind: number
  readonly defects: number
}

export class DevReport {
  #log: SubmitLogEntry[] = []
  constructor(private readonly description: FormDescription) {}

  attributes(): AttrRow[] {
    return this.description.fields.map((f) => {
      const { attrs, skipped } = this.description.attrsOf(f.name)
      return {
        field: f.name, input: f.input,
        constraints: this.description.constraintsOf(f.name).map((c) => c.kind),
        attrs, skipped,
      }
    })
  }

  /** Матрица собирается обходом реестра, а не записана литералом. */
  matrix(): MatrixRow[] {
    return this.description.registry.types.all().map((t) => ({
      kind: t.kind, accepts: Object.keys(t.constraints),
    }))
  }

  routing(errors: readonly FormError[]) {
    return errors.map((e) => ({
      code: e.code, path: e.path ?? '*', origin: e.origin,
      shown: e.message !== undefined, silent: e.silent === true,
    }))
  }

  record(entry: SubmitLogEntry): void { this.#log.push(entry) }
  submissions(): readonly SubmitLogEntry[] { return this.#log }

  health(): Health {
    const rows = this.attributes()
    const total = rows.reduce((n, r) => n + r.constraints.length, 0) || 1
    const skipped = rows.flatMap((r) => r.skipped)
    return {
      projected: (total - skipped.length) / total,
      opaque: rows.flatMap((r) => r.constraints).filter((k) => k === 'opaque').length,
      unknownKind: skipped.filter((s) => s.why.includes('не знает вида')).length,
      defects: this.description.defects.length,
    }
  }

  report(): string {
    const h = this.health()
    const lines = [
      `форма ${this.description.id} ревизия ${this.description.revision}`,
      `доля ограничений с атрибутом: ${(h.projected * 100).toFixed(0)}%`,
      `непроецируемых (opaque): ${h.opaque} · вид неизвестен типу: ${h.unknownKind}`,
      `дефектов описания: ${h.defects}`,
      '',
      'ограничения → атрибуты:',
    ]
    for (const r of this.attributes()) {
      lines.push(`  ${r.field} (${r.input}): ${JSON.stringify(r.attrs)}`)
      for (const s of r.skipped) lines.push(`      ${s.kind} — ${s.why}`)
    }
    return lines.join('\n')
  }
}
