// Тонкий загрузчик `/fields`: данные читаются из кэша процесса, а все POST-операции
// (сборка, запись, черновые мутации мест и сброс) обслуживает `#hooks/component-form`
// через `fields.form.server.ts`.
import { savedRecord, savedSet } from './fields.form.server.js'
import { maxFieldsOf, stepOf, type FieldsStep } from './forms.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ url, locals }) => {
  const set = savedSet()
  const record = savedRecord()
  const inlineStep: FieldsStep | null =
    locals.formResult?.formId === 'fields-builder'
      ? 'build'
      : locals.formResult?.formId === 'fields-record'
        ? 'fill'
        : null

  return {
    set,
    record,
    step: inlineStep ?? stepOf(url.searchParams.get('step'), Boolean(set), Boolean(record)),
    limit: maxFieldsOf(url.searchParams.get('limit')),
  }
}
