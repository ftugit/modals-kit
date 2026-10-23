// Невесомый реестр перехватчика сессии для `bindComponentForm` (~150 байт gzip,
// ноль зависимостей: не тянет `#lib/form` в начальный чанк страниц без форм).

export interface FormSessionInterceptor {
  /** Проверить/освежить истёкший временный токен в RAM перед отправкой запроса. */
  ensureFresh(): Promise<boolean>
  /** Вызывается при ответе `auth.expired`; если вернул `true`, запрос повторяется 1 раз. */
  onAuthExpired(): Promise<boolean>
}

let sessionInterceptor: FormSessionInterceptor | null = null

export function setFormSessionInterceptor(interceptor: FormSessionInterceptor | null): void {
  sessionInterceptor = interceptor
}

export function getFormSessionInterceptor(): FormSessionInterceptor | null {
  return sessionInterceptor
}
