// Вид состояния ссылок `asLink`/`asModalLink` — ОДНО правило на весь сайт.
//
// Почему CSS, а не разметка: `as*` не владеет элементом, потребитель ставит
// его на свою `<a>` или на `Button`. Атрибуты состояния (`data-state`,
// `data-task-percent`) пишет вложение, а рисует их этот CSS — одинаково на
// голой ссылке и на кнопке. Подключается как preflight UnoCSS
// (`unocss.config.ts`): в `app.css` по соглашению только токены.
//
// Свой вид поверх — обычными утилитами по тем же атрибутам, например
// оверлей карточки: `group-data-[state=loading]:opacity-60`.

/** Знак «!» в круге (как `WarningIcon`) — маска, цвет берётся из `background`. */
const WARNING_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M12 7v6M12 17h.01'/%3E%3C/svg%3E\")"

const LINK = ':where([data-link],[data-modal-link])'

export const LINK_INDICATOR_CSS = `
${LINK}[data-state=loading]::before,
${LINK}[data-state=error]::before {
  content: '';
  display: inline-block;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
  margin-inline-end: 0.375em;
  vertical-align: -0.125em;
}
${LINK}[data-state=loading]::before {
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-inline-end-color: transparent;
  border-radius: 9999px;
  animation: link-indicator-spin 0.7s linear infinite;
}
${LINK}[data-state=error]::before {
  background-color: var(--destructive);
  -webkit-mask: ${WARNING_MASK} center / contain no-repeat;
  mask: ${WARNING_MASK} center / contain no-repeat;
}
${LINK}[data-task-percent]::after {
  content: attr(data-task-percent) '%';
  margin-inline-start: 0.375em;
  font-size: 0.75em;
  font-variant-numeric: tabular-nums;
}
${LINK}[data-state=loading] { cursor: progress; }
${LINK}[aria-disabled=true] { cursor: not-allowed; }
${LINK}:not([data-slot=button])[aria-disabled=true] { opacity: 0.65; }
:where([data-slot=button])${LINK}::before { margin-inline-end: 0; }
:where([data-slot=button])${LINK}::after { margin-inline-start: 0; }
@keyframes link-indicator-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  ${LINK}[data-state=loading]::before { animation-duration: 2s; }
}
`
