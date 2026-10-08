// Единственное место приложения, где решается судьба ошибки (Q1).
//
// Lib про 500 и консоль не знают: каждая отдаёт нормализованный конверт
// `{lib, code, cause, ctx}` в подключённый `onError`-приёмник. Здесь — развилка:
//   DEV            — console.error + throw (штатный механизм: overlay/терминал);
//   прод + SSR     — критичное бросается ВВЕРХ по await-цепи → SvelteKit отдаёт
//                    настоящий HTTP 500 (+error.svelte);
//   прод + клиент  — критичное заменяет приложение на экран 500 (HTTP-статус
//                    после загрузки не изменить — UI неотличим);
//   не-критичное   — console.warn.
// Критичность выбирается СЦЕНАРИЕМ, а не lib: 500 только когда нечем рисовать
// страницу. Lib не импортируются типами ради независимости — конверт структурный.

export interface AppErrorEnvelope {
  readonly lib: string
  readonly code: string
  readonly cause: unknown
  readonly ctx?: Record<string, unknown>
}

let critical: AppErrorEnvelope | null = $state(null)

/** Снимок фатала: UI читает через геттер, назначает только `report`. */
export const appErrors = {
  get critical(): AppErrorEnvelope | null {
    return critical
  },
}

/** Сценарии, при которых приложение останавливается. Правится ТОЛЬКО здесь. */
export function isFatalError(e: AppErrorEnvelope): boolean {
  switch (e.lib) {
    case 'paginate':
      // данных нет вовсе: init упал (getInitial или первая страница).
      return e.code === 'init-failed' || (e.code === 'load-failed' && e.ctx?.phase === 'init')
    case 'form':
      // форма — часть страницы: её сбой не 500 (исходный контракт показа),
      // только серверный action-краш уже обрабатывает SvelteKit сам.
      return false
    case 'modals':
      // ошибка живёт в runtime записи — модалка покажет и даёт ретраить.
      return false
    default:
      return false
  }
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

/**
 * Приёмник для провайдеров и конфигов lib. Бросок намеренный: propagate —
 * серверный фатал доезжает до SvelteKit; DEV-throw виден как есть.
 * Дедуп: первый фатал и рисует экран, последующие игнорируются (защита от цикла).
 */
export function report(e: AppErrorEnvelope): void {
  if (import.meta.env.DEV) {
    console.error(`[${e.lib}:${e.code}]`, e.cause)
    throw asError(e.cause)
  }
  if (critical) return
  if (isFatalError(e)) {
    if (import.meta.env.SSR) throw asError(e.cause)
    critical = e
    return
  }
  console.warn(`[${e.lib}] ${e.code}`, e.cause)
}

/** Только для тестов: снять фатал. */
export function __resetCritical(): void {
  critical = null
}
