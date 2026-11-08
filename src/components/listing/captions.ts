/**
 * Подписи и текст чипа из описания формы. Вторая схема не нужна:
 * имя и подпись уже лежат в описании, оболочка списка их не знает.
 */

export function labelsFromFields(
  fields: readonly { name: string; label?: string }[],
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const labels: Record<string, string> = { ...extra }
  for (const field of fields) {
    if (field.label) labels[field.name] = field.label
  }
  return labels
}

export function textFromDescriptor(
  field: { input?: string; options?: readonly { value: string; label: string }[] } | undefined,
  value: string,
): string {
  const option = field?.options?.find((item) => item.value === value)
  if (option) return option.label
  // Флажок не имеет варианта: подписи поля достаточно, сырое «1» не показываем.
  if (field?.input === 'checkbox') return ''
  return value
}
