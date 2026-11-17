/**
 * Гейт механики успеха сессионной единицы (план сессий §6.1).
 *
 * Правило: успех в носителе не меняет адрес и не закрывает слой самовольно.
 * Переход — единственное исключение (закрыта своя авторизация), и он объявлен
 * в регистрации формы, а не собран в разметке: без JS сервер сам решает, куда
 * отправить ответ.
 *
 * Проверяется:
 *   1. в компоненте и модалке единицы нет навигации (`goto`, `redirect`,
 *      `location.assign`, `history.pushState`);
 *   2. модалка не закрывает слой сама (`modals.close()`) — это делает человек;
 *   3. серверная регистрация объявляет `redirectOnSuccess` (иначе без JS
 *      пользователь остался бы на странице подтверждения без ответа).
 *
 * Отключение по месту: `// session-delete-ok: причина`.
 */
import { readFileSync } from 'node:fs'

const UNIT = 'src/modules/user/base/svelte/session-delete'
const COMPONENT = `${UNIT}/SessionDelete.svelte`
const MODAL = 'src/modules/user/sessions/svelte/SessionDeleteModal.svelte'
const SERVER = 'src/modules/user/sessions/service/session-delete.form.server.ts'

const NAVIGATION = /\b(goto|redirect)\s*\(|location\.assign|history\.pushState/
const CLOSE = /modals\.close\s*\(/
const ACCEPT = 'session-delete-ok:'

/**
 * Найти нарушения механики успеха.
 * @param {{ path: string, source: string }[]} files
 */
export function findSessionDeleteViolations(files) {
  const byPath = new Map(files.map((f) => [f.path, f.source]))
  const out = []

  const scan = (path, pattern, rule) => {
    const source = byPath.get(path)
    if (source === undefined) {
      out.push({ path, line: 0, rule: 'файл единицы отсутствует', text: '' })
      return
    }
    source.split('\n').forEach((text, i) => {
      if (text.includes(ACCEPT)) return
      if (pattern.test(text)) out.push({ path, line: i + 1, rule, text: text.trim() })
    })
  }

  scan(COMPONENT, NAVIGATION, 'компонент меняет адрес сам')
  scan(MODAL, NAVIGATION, 'модалка меняет адрес сама')
  scan(MODAL, CLOSE, 'модалка закрывает слой самовольно')

  const server = byPath.get(SERVER) ?? ''
  if (!server.includes('redirectOnSuccess')) {
    out.push({ path: SERVER, line: 0, rule: 'нет объявленного перехода для случая без JS', text: '' })
  }
  return out
}

function unitSources() {
  const files = [COMPONENT, MODAL, SERVER].map((path) => ({
    path,
    source: safeRead(path),
  }))
  return files
}

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export function run() {
  // Отсутствие файла — тоже нарушение: проверяем только существующие.
  const files = unitSources().filter((f) => f.source !== undefined)
  return findSessionDeleteViolations(files).map((v) => `${v.path}:${v.line}: ${v.rule} — ${v.text}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = run()
  if (problems.length) {
    console.error('session-delete-guard: найдено нарушений:', problems.length)
    for (const p of problems) console.error('  ' + p)
    process.exit(1)
  }
  console.log('session-delete-guard: ok')
}
