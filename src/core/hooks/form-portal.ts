/**
 * Сохранить принадлежность контролов форме, когда DOM-поддерево перенесено в
 * портал. Чужой явно заданный `form` не менять. Наблюдение за новыми узлами
 * прекращается при вызове возвращённой функции.
 */
export function associatePortalControls(
  root: HTMLElement,
  formId: string,
  options: { cleanup?: boolean; nextFrame?: boolean } = {},
): () => void {
  const stamped: HTMLElement[] = []
  const apply = () => {
    for (const el of root.querySelectorAll<HTMLElement>('input, select, textarea, button')) {
      if (el.hasAttribute('form')) continue
      el.setAttribute('form', formId)
      if (options.cleanup) stamped.push(el)
    }
  }
  apply()
  const observer = new MutationObserver(apply)
  observer.observe(root, { childList: true, subtree: true })
  const frame = options.nextFrame ? requestAnimationFrame(apply) : undefined
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    observer.disconnect()
    for (const el of stamped) {
      if (el.getAttribute('form') === formId) el.removeAttribute('form')
    }
  }
}
