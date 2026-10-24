/**
 * Формат решений по шагам переноса схемы: `<решение>|<ключ шага>`.
 *
 * Зачем отдельный модуль. Ключ шага (`stepKey`) содержит `:`, `"` и `.`
 * (`rename_or_replace:"public"."post":label`), поэтому он не может быть ИМЕНЕМ
 * поля формы, у которой есть свои правила имён (`lib/form`: `^[a-z][a-z0-9_]{0,31}$`,
 * `maxSegments: 4`). Отсюда два законных представления одного и того же
 * `Resolution`:
 *
 * 1. **Значение** — `s0 = "rename|rename_or_replace:\"public\".\"post\":label"`.
 *    Имя поля короткое и допустимое (`s0`), ключ шага едет в значении. Так
 *    работает приложение на `lib/form` (поле строится из СВЕЖЕГО отчёта, поэтому
 *    ключ известен заранее и сверяется с картой — см. `decisionsFrom`).
 * 2. **Имя** — `step:<ключ шага> = "rename"`. Так собирает решения нативная
 *    HTML-форма без `lib/form`: имя — произвольная строка, ограничений нет
 *    (`decisionsFromForm`).
 *
 * Модуль зависит только от веб-стандартов (`FormData`, итераторы, объекты) и не
 * знает ни про `lib/form`, ни про HTTP: поэтому он годится и чужому приложению,
 * которое берёт `#lib/db` без нашего UI-слоя.
 *
 * Закрытая дыра. Разбор через `indexOf("|")` без проверок (как было в демо
 * раньше) принимал `"apply"` без разделителя за решение с ключом `"apply"`, а
 * `"drop table|x"` — за `Choice` приведением типа. Здесь любое значение, не
 * прошедшее `parseDecision`, — отказ, а не мусорное решение в БД.
 */
import type { Step } from "./plan";

/**
 * Решение по конфликтному шагу: `apply` — выполнить предложенный SQL (у шагов с
 * потерей данных — удалить колонку, сменить тип); `rename`/`replace` — у
 * `rename_or_replace`: переименовать старую колонку или удалить её и добавить новую.
 */
export type Choice = "apply" | "rename" | "replace";

/** Решения по шагам: ключ — `stepKey(step)`. */
export type Resolution = Readonly<Record<string, Choice>>;

/**
 * Устойчивый ключ шага: по нему экран решений и сервер говорят об одном шаге.
 * @param step шаг плана `./plan`.
 * @returns `<вид>:<таблица>:<колонка>`.
 */
export function stepKey(step: Step): string {
  return `${step.kind}:${step.table}:${step.column ?? ""}`;
}

/**
 * Какие решения возможны у шага. Пусто — само не снять: нужна правка модели или данных.
 * @param step шаг плана `./plan`.
 * @returns решения, которые `sync` примет для этого шага.
 */
export function choices(step: Step): readonly Choice[] {
  if (step.level === "auto") return [];
  if (step.kind === "rename_or_replace") return ["rename", "replace"];
  // уникальный индекс на данных с повторами упадёт: сначала убрать повторы
  if (step.kind === "unique_duplicates") return [];
  return step.sql.length ? ["apply"] : [];
}

/** Слово «ничего не делать» в значении поля: шаг остаётся как есть. */
export const KEEP = "keep";

/** Действия, которые принимает `DbSchema.sync` (`Choice`); `keep` — только для формы. */
const CHOICES: ReadonlySet<string> = new Set<Choice>(["apply", "rename", "replace"]);

/** Что может стоять в значении поля шага: решение или отказ от решения. */
export type DecisionChoice = Choice | typeof KEEP;

/** Разобранное значение поля: `<choice>|<key>` без потерь. */
export interface ParsedDecision {
  readonly choice: DecisionChoice;
  readonly key: string;
}

/**
 * Собрать значение поля шага.
 *
 * @param choice решение (`apply`/`rename`/`replace`) либо `keep`.
 * @param key устойчивый ключ шага (`stepKey(step)`).
 * @returns строка для `value` варианта формы.
 * @throws TypeError, если ключ пуст или выбран неизвестный вид решения.
 */
export function decisionValue(choice: DecisionChoice, key: string): string {
  if (!key) throw new TypeError("decisionValue: ключ шага обязателен");
  if (choice !== KEEP && !CHOICES.has(choice))
    throw new TypeError(`decisionValue: неизвестное решение «${String(choice)}»`);
  return `${choice}|${key}`;
}

/**
 * Разобрать значение поля шага.
 *
 * Отказ (`null`) — на любую строку, которую нельзя пустить в `sync`:
 * нет разделителя (`"apply"`), пустое решение (`"|key"`), пустой ключ
 * (`"apply|"`), неизвестное решение (`"drop table|key"`).
 *
 * @param raw значение из формы (может быть `File`, `undefined`, числом — всё не строка).
 * @returns решение и ключ либо `null`.
 */
export function parseDecision(raw: unknown): ParsedDecision | null {
  if (typeof raw !== "string") return null;
  const cut = raw.indexOf("|");
  if (cut <= 0 || cut === raw.length - 1) return null;
  const choice = raw.slice(0, cut);
  if (choice !== KEEP && !CHOICES.has(choice)) return null;
  return { choice: choice as DecisionChoice, key: raw.slice(cut + 1) };
}

/** Значения формы: объект полей либо итерируемая пара `[имя, значение]`. */
export type DecisionValues =
  | Readonly<Record<string, unknown>>
  | Iterable<readonly [string, unknown]>;

/** Что нашлось в значениях формы. */
export interface DecisionsResult {
  /** Решения для `sync` — только по шагам из карты, без `keep`. */
  readonly decisions: Resolution;
  /**
   * Поля, которые не удалось принять: битое значение, чужой ключ шага.
   * Пусто — форма (и отчёт, из которого она построена) согласованы.
   */
  readonly problems: readonly string[];
}

/**
 * @param values объект или пары; обычно `Record<string, unknown>` из `#lib/form`.
 * @returns пары `[имя, значение]` в порядке объявления.
 */
function entriesOf(values: DecisionValues): Iterable<readonly [string, unknown]> {
  // Массив пар и `Map` — итерируемы; запись полей формы — нет (её берём записью).
  const iterable = values as Partial<Iterable<readonly [string, unknown]>>;
  return typeof iterable?.[Symbol.iterator] === "function"
    ? (values as Iterable<readonly [string, unknown]>)
    : Object.entries(values as Readonly<Record<string, unknown>>);
}

/**
 * Собрать `Resolution` из значений формы, сверяя КАЖДЫЙ ключ с отчётом.
 *
 * Ключ берётся из карты `поле формы → ключ шага`, а не из значения: карта —
 * это текущий отчёт сервера. Поэтому решение, приехавшее на устаревшем экране
 * (шаг уже снят), не уйдёт в `sync` мусором, а попадёт в `problems` — экран
 * перерисовывается, человек решает заново.
 *
 * @param values значения формы (объект или пары).
 * @param fieldToKey карта «имя поля → `stepKey`» из СВЕЖЕГО отчёта.
 * @returns решения и список непринятых полей.
 */
export function decisionsFrom(
  values: DecisionValues,
  fieldToKey: Readonly<Record<string, string>>,
): DecisionsResult {
  const decisions: Record<string, Choice> = {};
  const problems: string[] = [];
  for (const [field, raw] of entriesOf(values)) {
    const key = fieldToKey[field];
    if (key === undefined) continue; // поле не про шаг (секрет, служебные ключи формы)
    if (raw === undefined || raw === null || raw === "") continue; // ничего не выбрано
    const parsed = parseDecision(raw);
    if (!parsed) {
      problems.push(`Поле «${field}»: значение «${String(raw)}» не похоже на решение шага`);
      continue;
    }
    if (parsed.key !== key) {
      problems.push(`Поле «${field}»: решение относится к шагу «${parsed.key}», а не к «${key}»`);
      continue;
    }
    if (parsed.choice === KEEP) continue;
    decisions[key] = parsed.choice;
  }
  return { decisions: Object.freeze(decisions), problems: Object.freeze(problems) };
}

/**
 * Решения из нативной формы без `lib/form`: поля `step:<ключ шага>` со значением
 * `apply` | `rename` | `replace`. Пустое значение и чужие имена — «не трогать».
 *
 * @param data тело нативного POST.
 * @returns решения для `sync` (ключ — `stepKey(step)`).
 */
export function decisionsFromForm(data: FormData): Resolution {
  const out: Record<string, Choice> = {};
  for (const [name, value] of data) {
    if (!name.startsWith("step:") || typeof value !== "string" || !CHOICES.has(value)) continue;
    const key = name.slice(5);
    if (key) out[key] = value as Choice;
  }
  return out;
}
