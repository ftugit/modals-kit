export type SelectSearchMode = 'off' | 'value' | 'label' | 'both';

export interface SelectOption {
  value: string;
  label: string;
  /**
   * Пояснение к варианту: показывается ТОЛЬКО в расширенном списке (после
   * гидратации) приглушённым текстом. В native `<option>` не попадает, иначе
   * без JS список раздувается и растягивает сам `<select>`.
   * Пример: value `+7`, label `+7`, hint «Россия, Казахстан».
   */
  hint?: string;
  disabled?: boolean;
}

/**
 * Приведение строки к сравнимому виду: регистр и диакритика.
 *
 * NFKD разлагает «ё» на «е» + комбинируемую точку, «й» — на «и» + кратка,
 * поэтому после снятия комбинируемых знаков запрос «сенен» находит «Сёнен»,
 * «сейнэн» — «Сэйнэн». Без этого поиск по подписи «работает» ровно до первой
 * буквы с точками — а подписи жанров у источника именно такие.
 */
function searchable(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
}

/**
 * Локальный substring-поиск; режим явно определяет доступные для поиска поля.
 *
 * `label` (и `both`) ищут по тому, что человек ВИДИТ: подпись вместе с
 * пояснением — `hint` показывается рядом с ней и воспринимается как часть
 * названия варианта.
 */
export function matchesSelectOption(
  option: Pick<SelectOption, 'value' | 'label' | 'hint'>,
  query: string,
  mode: SelectSearchMode,
): boolean {
  if (mode === 'off' || !query) return true;
  const needle = searchable(query);
  const visible = option.hint ? `${option.label} ${option.hint}` : option.label;
  const byValue = (mode === 'value' || mode === 'both') && searchable(option.value).includes(needle);
  const byLabel = (mode === 'label' || mode === 'both') && searchable(visible).includes(needle);
  return byValue || byLabel;
}

export function selectedAfterToggle(
  selected: readonly SelectOption[],
  option: SelectOption,
  multiple: boolean,
): SelectOption[] {
  if (option.disabled) return [...selected];
  if (!multiple) return [option];
  return selected.some(item => item.value === option.value)
    ? selected.filter(item => item.value !== option.value)
    : [...selected, option];
}

/** Выбирает/снимает только видимые enabled options, не теряя выбор вне фильтра. */
export function selectedAfterToggleAll(
  selected: readonly SelectOption[],
  visible: readonly SelectOption[],
  allVisibleSelected: boolean,
): SelectOption[] {
  const enabledValues = new Set(visible.filter(option => !option.disabled).map(option => option.value));
  if (allVisibleSelected) return selected.filter(option => !enabledValues.has(option.value));
  const result = [...selected];
  const present = new Set(result.map(option => option.value));
  for (const option of visible) {
    if (!option.disabled && !present.has(option.value)) {
      result.push(option);
      present.add(option.value);
    }
  }
  return result;
}
