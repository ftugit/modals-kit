import { matchesQuery, prepareQuery, prepareTexts, type PreparedText } from '#lib/paginate/search/fuzzy.js';

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
 * Приведение строки к сравнимому виду: регистр и диакритика (поиск по значению).
 *
 * NFKD разлагает «ё» на «е» + комбинируемую точку, «й» — на «и» + кратка,
 * поэтому после снятия комбинируемых знаков «сенен» находит «Сёнен».
 */
function searchable(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
}

/** Подготовленный видимый текст варианта: один раз на объект варианта. */
const preparedLabels = new WeakMap<object, PreparedText[]>();
function labelTexts(option: Pick<SelectOption, 'label' | 'hint'>): PreparedText[] {
  let texts = preparedLabels.get(option);
  if (!texts) {
    texts = prepareTexts(option.hint ? [option.label, option.hint] : [option.label]);
    preparedLabels.set(option, texts);
  }
  return texts;
}

/** Токены последнего запроса: фильтр зовётся на каждый вариант с одним и тем же вводом. */
let lastQuery = '';
let lastTokens: string[] = [];
function queryTokens(query: string): string[] {
  if (query !== lastQuery) {
    lastQuery = query;
    lastTokens = prepareQuery(query);
  }
  return lastTokens;
}

/**
 * Локальный фильтр вариантов; режим явно определяет доступные для поиска поля.
 *
 * - `value` — подстрока значения (коды, id: опечатки там не бывают «почти верными»).
 * - `label` (и `both`) — по тому, что человек ВИДИТ: подпись вместе с
 *   пояснением, через `matchesQuery` из paginate/search — подстрока, начало слова и
 *   опечатки («kioto» → «Kyoto Animation», «сенэн» → «Сёнен»), без шумной
 *   подпоследовательности. Запрос без букв и цифр («-») — подстрокой.
 *
 * Порядок вариантов не меняется: это фильтр, а не сортировка.
 */
export function matchesSelectOption(
  option: Pick<SelectOption, 'value' | 'label' | 'hint'>,
  query: string,
  mode: SelectSearchMode,
): boolean {
  if (mode === 'off' || !query) return true;
  const byValue = (mode === 'value' || mode === 'both') && searchable(option.value).includes(searchable(query));
  if (byValue) return true;
  if (mode === 'value') return false;
  const tokens = queryTokens(query);
  if (!tokens.length) {
    const visible = option.hint ? `${option.label} ${option.hint}` : option.label;
    return searchable(visible).includes(searchable(query));
  }
  return matchesQuery(labelTexts(option), tokens);
}

export function selectedAfterToggle(
  selected: readonly SelectOption[],
  option: SelectOption,
  multiple: boolean,
): SelectOption[] {
  if (option.disabled) return [...selected];
  const selectedOption = selected.some(item => item.value === option.value)
  if (selectedOption) return multiple ? selected.filter(item => item.value !== option.value) : []
  return multiple ? [...selected, option] : [option]
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
