/**
 * Гейт «цель из авторизации, а не из клиента» (S1 плана сессий).
 *
 * Зачем: если компонент выбирает адрес отправки по сравнению с клиентским зеркалом
 * (`vault.principal`), то при пустом или отставшем зеркале своё устройство считается
 * чужим и закрытие уходит на адрес чужого аккаунта — человек получает отказ на
 * собственном устройстве. Граница безопасности не должна зависеть от состояния
 * браузера: цель приходит параметром, права решает сервер.
 *
 * Что проверяется в `src/content/user/ui/**`:
 *   1. в строке, собирающей адрес (`href(`, `?/revoke`, `?/rename`), нет `vault.principal`;
 *   2. нет молчаливого вычитания себя из набора: `!== vault.principal` / `!== selfId`
 *      внутри `filter(...)` и в нормализации целей.
 *
 * Сравнение с зеркалом для показа кнопок и подписей разрешено — запрещён только выбор
 * адреса и состава данных. Отключение по месту: `// target-rule-ok: причина`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const UI_DIR = 'src/content/user/ui'

/** Признаки строки, которая строит адрес. */
const ADDRESS_RE = /href\(|\?\/revoke|\?\/rename/
/** Клиентское зеркало авторизации. */
const MIRROR_RE = /vault\.principal/
/** Молчаливое вычитание себя. */
const SUBTRACT_RE = /!==\s*(vault\.principal|selfId)/

/**
 * Найти нарушения правила цели.
 * @param {{ path: string, source: string }[]} files
 * @returns {{ path: string, line: number, rule: string, text: string }[]}
 */
export function findTargetRuleViolations(files, window = 3) {
  const out = []
  for (const { path, source } of files) {
    const lines = source.split('\n')
    lines.forEach((text, i) => {
      if (text.includes('target-rule-ok:')) return
      // Адрес и зеркало часто стоят в одном многострочном выражении: смотрим
      // окно вокруг строки с адресом, а не только саму строку.
      if (ADDRESS_RE.test(text)) {
        const from = Math.max(0, i - window)
        const to = Math.min(lines.length, i + window + 1)
        const near = lines.slice(from, to).some((l) => MIRROR_RE.test(l))
        if (near) {
          out.push({ path, line: i + 1, rule: 'адрес выбран по клиентскому зеркалу', text: text.trim() })
          return
        }
      }
      if (SUBTRACT_RE.test(text) && /filter\(|normalize|subjects|uids/i.test(text)) {
        out.push({ path, line: i + 1, rule: 'молчаливое вычитание цели из набора', text: text.trim() })
      }
    })
  }
  return out
}

function uiSources() {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.svelte') || name.endsWith('.ts')) {
        files.push({ path, source: readFileSync(path, 'utf8') })
      }
    }
  }
  walk(UI_DIR)
  return files
}

export function run() {
  return findTargetRuleViolations(uiSources()).map(
    (v) => `${v.path}:${v.line}: ${v.rule} — ${v.text}`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = run()
  if (problems.length) {
    console.error('target-rule-guard: найдено нарушений:', problems.length)
    for (const p of problems) console.error('  ' + p)
    process.exit(1)
  }
  console.log('target-rule-guard: ok')
}
