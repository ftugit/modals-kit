/**
 * ark-owns — страж против «написал руками то, что уже есть в Ark».
 *
 * Зачем: при дословном порте Solid → Svelte легко перенести обвязку, которая
 * в оригинале существовала по историческим причинам, хотя машина Zag умеет это
 * пропом. Человек (и ИИ) такое не замечает: код «работает», ревью проходит,
 * а в проекте оседает вторая реализация фокуса или scroll-lock.
 *
 * Каждое правило ссылается на РЕАЛЬНЫЙ проп, проверенный по типам
 * @zag-js/dialog@DialogProps (см. §0α плана). Выдумок здесь нет.
 *
 * Отключение по месту — комментарием в той же строке:
 *     someCode() // ark-owns-ok: причина
 */

/** Правила: что ищем и каким пропом Ark это заменяется. */
export const ARK_RULES = [
  {
    id: 'restore-focus',
    pattern: /\b(preOpenEl|previouslyFocused|lastFocused|triggerRef)\b/,
    prop: 'restoreFocus / finalFocusEl',
    why:
      'Возврат фокуса на элемент, который был активен до открытия, машина диалога\n' +
      '    делает сама: restoreFocus (булев) или finalFocusEl (() => Element).',
  },
  {
    id: 'initial-focus',
    pattern: /\bstage\w*\.focus\s*\(|\bcontent\(\)\.focus\s*\(/,
    prop: 'initialFocusEl',
    why: 'Куда встаёт фокус при открытии — проп initialFocusEl: () => Element.',
  },
  {
    id: 'scroll-lock',
    pattern: /(document|body)\s*\.\s*(body\s*\.\s*)?style\s*\.\s*overflow\s*=/,
    prop: 'preventScroll',
    why: 'Блокировка прокрутки под диалогом — проп preventScroll (по умолчанию true).',
  },
  {
    id: 'focus-trap',
    pattern: /key\s*===\s*['"]Tab['"]|\.key\s*==\s*['"]Tab['"]/,
    prop: 'trapFocus',
    why: 'Ловушка фокуса по Tab — проп trapFocus (по умолчанию true).',
  },
  {
    id: 'hide-outside',
    pattern: /setAttribute\(\s*['"]aria-hidden['"]/,
    prop: 'modal',
    why:
      'Сокрытие остального документа от скринридера делает проп modal —\n' +
      '    он же выключает указательное взаимодействие снаружи.',
  },
  {
    id: 'focusin-heuristic',
    pattern: /type\s*===\s*['"]focusin['"]/,
    prop: 'persistentElements',
    why:
      'Фильтр «focusin — не клик по фону» был обходным путём для чужих порталов.\n' +
      '    Штатное средство — persistentElements: () => Element[] (PersistentElementOptions\n' +
      '    входит в DialogProps): перечисленные узлы считаются частью диалога.',
  },
  {
    id: 'dialog-role',
    pattern: /role\s*=\s*['"{]?\s*['"]?(dialog|alertdialog)['"]/,
    prop: 'role',
    why: 'Роль диалога выставляет машина: проп role: "dialog" | "alertdialog".',
  },
]

const OPT_OUT = /\/\/\s*ark-owns-ok\b/

/**
 * Проверяет исходник. Чистая функция — прогоняется без файловой системы.
 * @returns {Array<{id:string, line:number, prop:string, text:string}>}
 */
export function scanSource(source, rules = ARK_RULES) {
  const findings = []
  const lines = source.split('\n')
  let inBlockComment = false

  lines.forEach((raw, i) => {
    const line = raw.trim()

    // грубый пропуск комментариев: правила ищут КОД, а не пояснения к нему
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
      return
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true
      return
    }
    if (line.startsWith('//') || line.startsWith('*')) return
    if (OPT_OUT.test(raw)) return

    for (const rule of rules) {
      if (rule.pattern.test(raw)) {
        findings.push({ id: rule.id, line: i + 1, prop: rule.prop, text: line.slice(0, 100) })
      }
    }
  })

  return findings
}

/** Человеческий отчёт: что нашли, чем заменить и как отключить. */
export function formatFindings(file, findings, rules = ARK_RULES) {
  if (findings.length === 0) return ''
  const byId = new Map(rules.map((r) => [r.id, r]))
  const out = [`\n[ark-owns] ${file}: это уже умеет Ark — не пишите руками.\n`]
  for (const f of findings) {
    const rule = byId.get(f.id)
    out.push(`  ${file}:${f.line}  [${f.id}]`)
    out.push(`    ${f.text}`)
    out.push(`    → проп Ark: ${rule.prop}`)
    out.push(`    ${rule.why}`)
    out.push('')
  }
  out.push('  Если случай действительно особый — допишите в строке:')
  out.push('      // ark-owns-ok: почему проп Ark здесь не подходит')
  out.push('  и занесите отклонение в журнал §6 плана.\n')
  return out.join('\n')
}
