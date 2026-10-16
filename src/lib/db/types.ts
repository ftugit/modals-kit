/**
 * Независимые от HTTP/ORM контракты; все ctx создаются доверенным сервером.
 * Стандарт-схемы берутся из `@standard-schema/spec`: это тот же контракт,
 * который принимают SvelteKit-формы и `superforms`, поэтому схема поля может
 * быть любой (zod, valibot, своя из `./schema`).
 */
import type { StandardSchemaV1 } from "@standard-schema/spec";
export type Row = Record<string, unknown>;
export interface Statement {
  text: string;
  values?: readonly unknown[];
  /**
   * Отмена whole-query. Ресурс-слой берёт её из `DataContext.signal`,
   * то есть из серверного контекста; значение из клиентского тела сюда
   * попасть не может. Драйверы без поддержки (PGlite) обязаны её игнорировать.
   */
  signal?: AbortSignal;
}
export interface QueryResult<T extends Row = Row> {
  rows: T[];
  rowCount: number;
}
export type Isolation = "read committed" | "repeatable read" | "serializable";
export interface TxOptions {
  isolation?: Isolation;
  readOnly?: boolean;
  /**
   * Отмена ВСЕЙ транзакции (в SvelteKit — `event.request.signal`).
   * Только транзакционные адаптеры; при срабатывании — ROLLBACK и
   * DbFailure('unavailable'). Не выставляется ресурс-слоем автоматически:
   * атомарная запись не должна молча отменяться уходом со страницы.
   */
  signal?: AbortSignal;
}
export interface Capabilities {
  transactions: boolean;
  savepoints: boolean;
  sqlstate: boolean;
  isolationLevels: readonly Isolation[];
}
export interface Driver {
  /** Только composition root: закрывает proxy resources и отменяет pending I/O. */
  close?(): Promise<void>;
  readonly capabilities: Capabilities;
  readonly inTransaction?: boolean;
  query<T extends Row = Row>(statement: Statement): Promise<QueryResult<T>>;
  transaction<T>(
    fn: (tx: Driver) => Promise<T>,
    options?: TxOptions,
  ): Promise<T>;
}
export interface DataContext {
  readonly principal: {
    readonly id?: string;
    readonly roles: readonly string[];
  };
  readonly requestId?: string;
  /**
   * Отмена запроса (`event.request.signal` в SvelteAdapted). Ставится ТОЛЬКО
   * сервером: клиент не может ни включить, ни снять её.
   */
  readonly signal?: AbortSignal;
}
export type Grant = readonly string[] | ((ctx: DataContext) => boolean);
export type Operator =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "notIn"
  | "isNull"
  | "isNotNull"
  | "contains"
  | "startsWith"
  | "icontains"
  | "istartsWith";
export type Filter =
  | boolean
  | { field: string; op: Operator; value?: unknown }
  | { and: readonly Filter[] }
  | { or: readonly Filter[] }
  | { not: Filter };
export type Order = readonly (readonly [string, "asc" | "desc"])[];
export interface Limits {
  pageSize: number;
  maxPageSize: number;
  maxPage: number;
  filterDepth: number;
  filterNodes: number;
  inValues: number;
  inputKeys: number;
}
/** Технические, не бизнес-квоты. Приложение передаёт limits явно. */
export const conservativeLimits: Readonly<Limits> = Object.freeze({
  pageSize: 20,
  maxPageSize: 100,
  maxPage: 10000,
  filterDepth: 8,
  filterNodes: 100,
  inValues: 100,
  inputKeys: 64,
});
export type StandardSchema<T = unknown> = StandardSchemaV1<unknown, T>;
export interface Field<T = unknown> {
  column?: string;
  schema: StandardSchema<T>;
  kind?: "scalar" | "bigint" | "decimal" | "date" | "timestamp" | "json";
  /** Маски: нет ключа или `null` — всем, `[]` — никому, роли или функция — по ним. */
  read?: Grant | null;
  create?: Grant | null;
  update?: Grant | null;
  generated?: boolean;
  immutable?: boolean;
  required?: boolean;
  nullable?: boolean;
  normalize?: (v: unknown) => unknown;
  createValue?: (ctx: DataContext) => unknown;
  /**
   * Заполнить, если поле не передано: `values` — уже проверенные переданные поля.
   * `undefined` — не заполнять (так при `update` поле остаётся как было). Значение
   * проходит правила поля. Переданное значение (если `create`/`update` разрешает)
   * побеждает: `fill` его не трогает.
   */
  fill?: (values: Readonly<Row>, ctx: DataContext, operation: "insert" | "update") => unknown | Promise<unknown>;
  /**
   * Как хранить: вызывается ПОСЛЕ правил поля (и после `fill`), до `beforeWrite`,
   * `checks` и SQL — например, хэш пароля. `null` не передаётся. Правила поля описывают
   * то, что приходит, а не то, что лежит в колонке, поэтому нужен явный `db.type`, и
   * CHECK из правил не строится.
   */
  store?: (value: unknown, ctx: DataContext) => unknown | Promise<unknown>;
  filters?: readonly Operator[];
  orderable?: boolean;
  /** Колонка в БД: то, чего не видно из схемы поля (см. `#lib/db/sync/index.js`). */
  db?: ColumnOptions;
  /**
   * Свои тексты ошибок поля по коду: `{ unique: 'Этот email уже зарегистрирован',
   * minLength: 'Минимум {min} символов' }`. Подстановки — из параметров ошибки.
   * Сильнее словарей формы, как `.message()` у правила формы.
   */
  messages?: Readonly<Record<string, string>>;
}
/**
 * Подробности колонки для `defineSchema`. Значения пишет разработчик в коде, не
 * пользователь: `default` попадает в DDL как SQL-выражение.
 */
export interface ColumnOptions {
  /** Тип PostgreSQL. Обязателен, если схема поля не из `s.*` (zod, valibot, своя). */
  type?: string;
  /** SQL-выражение DEFAULT: `'clock_timestamp()'`, `'gen_random_uuid()'`, `"'draft'"`. */
  default?: string;
  /** Уникальность. У ресурса с `softDelete` — среди неудалённых строк. */
  unique?: boolean;
  /**
   * Внешний ключ: значение поля — ключ записи другого ресурса. Ресурс задаётся
   * функцией (ссылки бывают взаимными, порядок загрузки модулей не важен).
   * `field` — поле цели (по умолчанию её `primaryKey`), `onDelete` — что делает БД при
   * настоящем удалении цели (по умолчанию `no action`; мягкое удаление — `softDelete.children`).
   */
  references?: ColumnReference;
}
export interface ColumnReference {
  resource: () => Resource;
  field?: string;
  onDelete?: "no action" | "restrict" | "cascade" | "set null";
}
/**
 * Что делать с дочерними записями при мягком удалении родителя.
 * `cascade` — пометить удалёнными и их (у дочернего ресурса обязан быть `softDelete`);
 * `restrict` — не удалять, пока есть неудалённые дочерние (`conflict`, 409).
 */
export interface SoftDeleteChild {
  resource: Resource;
  /** Поле дочернего ресурса, в котором лежит `primaryKey` родителя. */
  field: string;
  onDelete: "cascade" | "restrict";
}
export type Fields = Record<string, Field>;
export type InferRow<F extends Fields> = {
  [K in keyof F]: F[K] extends Field<infer T> ? T : never;
};
export type Operation = "select" | "insert" | "update" | "delete";
export interface HookContext {
  readonly ctx: DataContext;
  readonly operation: Operation;
  readonly db: Database;
  readonly before?: Readonly<Row>;
  readonly row?: Readonly<Row>;
  readonly draft?: Row;
}
export interface Hooks {
  beforeWrite?: (event: HookContext) => void | Promise<void>;
  afterWrite?: (event: HookContext) => void | Promise<void>;
  afterRead?: (event: {
    ctx: DataContext;
    rows: readonly Readonly<Row>[];
  }) => void | Promise<void>;
  afterCommit?: (
    event: Omit<HookContext, "db" | "draft">,
  ) => void | Promise<void>;
}
/**
 * Правила данных (`Resource.checks`): то, что видно только из БД или из нескольких
 * полей сразу — «slug уже занят», «у черновика нет даты публикации». Выполняются
 * всегда: при записи — в той же транзакции, после проверки полей и `beforeWrite`;
 * в `validator` — над значениями формы, без записи.
 */
export interface CheckEvent {
  readonly ctx: DataContext;
  /** `check` — только из `validator(ctx, 'check')`: проверка без записи (форма входа). */
  readonly operation: "insert" | "update" | "check";
  /** При записи — транзакция записи; в `validator` — сама база. */
  readonly db: Database;
  /** Значения после проверки полей (и после `beforeWrite` при записи). */
  readonly values: Readonly<Row>;
  /** Строка до изменения — только у `update`. */
  readonly before?: Readonly<Row>;
}
/**
 * Нарушение правила данных. `field` — поле, у которого показать ошибку (нет — ошибка
 * всей записи). Текст: `message` — свой текст правила (сильнее словарей); без него —
 * `messages` поля по коду, иначе словарь формы по коду (`unique` → «Это значение уже занято»).
 */
export interface CheckIssue {
  field?: string;
  code: string;
  params?: Record<string, unknown>;
  message?: string;
}
export type Checks = (
  event: CheckEvent,
) => readonly CheckIssue[] | void | Promise<readonly CheckIssue[] | void>;
export type Relations = Record<
  string,
  { resource: Resource; localField: string; foreignField: string }
>;
export type ResourceRow<F extends Fields, R extends Relations> = Partial<
  InferRow<F>
> & {
  [K in keyof R]?: Partial<InferRow<R[K]["resource"]["fields"]>> | null;
};
export interface Resource<
  F extends Fields = Fields,
  R extends Relations = Relations,
> {
  key: string;
  table: string;
  primaryKey: string;
  ownerField?: string;
  fields: F;
  mandatoryRead?: readonly string[];
  /**
   * Правила строк. Нет `policy` (или `null`) — без ограничения; нет правила операции — то же
   * для неё.
   */
  policy?: Policy;
  order: Order;
  hooks?: Hooks;
  /** Правила данных: при записи — всегда и в транзакции; см. `CheckEvent`. */
  checks?: Checks;
  relations?: R;
  /** Только явно зарегистрированные metadata + grant могут попасть в публичную ошибку. */
  constraints?: Record<
    string,
    { sqlstate: string; fields: readonly string[]; expose: Grant }
  >;
  validateFinal?: StandardSchema<Row>;
  softDelete?: {
    field: string;
    value: (ctx: DataContext) => unknown;
    readDeleted: Grant;
    /**
     * Дочерние ресурсы и правило для каждого. Функция — чтобы ресурсы могли ссылаться
     * друг на друга (родитель объявлен раньше ребёнка). Как и каскад внешнего ключа,
     * правило выполняется без политик дочернего ресурса.
     */
    children?: () => readonly SoftDeleteChild[];
  };
  /**
   * Системные поля времени. Значение — имя поля (и колонки); поле создаёт
   * `defineResource`, объявлять его в `fields` нельзя. Каждое — время, читается всеми,
   * кто видит строку, клиент его не пишет, значение ставит база (`clock_timestamp()`),
   * сортировка и фильтры `gt/gte/lt/lte` разрешены.
   *
   * - `createdAt` — при вставке;
   * - `updatedAt` — при вставке и при каждом `update` (и `restore`);
   * - `deletedAt` — мягкое удаление: `delete` ставит метку, чтение её скрывает,
   *   `restore` снимает. Удалённые не видит и не восстанавливает никто, пока не задано
   *   `readDeleted` в объектной форме. Несовместимо с ручным `softDelete`.
   *
   * Что из этого следует для опроса изменений — `liveCapabilities(resource)`.
   */
  timestamps?: Timestamps;
  /** Индексы и составная уникальность для `defineSchema`. */
  db?: {
    indexes?: readonly (readonly string[])[];
    unique?: readonly (readonly string[])[];
  };
}
export interface Policy {
  select?: (ctx: DataContext) => Filter;
  insert?: (ctx: DataContext) => boolean;
  update?: (ctx: DataContext) => Filter;
  delete?: (ctx: DataContext) => Filter;
  /** Какие удалённые строки можно восстановить (`restore`). Нет — та же, что у `delete`. */
  restore?: (ctx: DataContext) => Filter;
}
/** Пустое значение (`null`, `''`, нет ключа) — метка выключена. */
export interface Timestamps {
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?:
    | string
    | null
    | {
        field: string | null;
        /** Кто видит удалённые (`includeDeleted`) и может их восстановить. Нет — никто. */
        readDeleted?: Grant;
        children?: () => readonly SoftDeleteChild[];
      };
}
/** Поля, которые `defineResource` создаёт из `timestamps` (для типа строки). */
type TimestampName<V> = Exclude<Extract<V, string>, "">;
export type TimestampFields<T extends Timestamps | null | undefined> = T extends Timestamps
  ? { [K in TimestampName<T["createdAt"]>]: Field<string> } & {
      [K in TimestampName<T["updatedAt"]>]: Field<string>;
    } & {
      [K in T["deletedAt"] extends { field: infer N }
        ? TimestampName<N>
        : TimestampName<T["deletedAt"]>]: Field<string | null>;
    }
  : {};
/**
 * Что ресурс умеет сообщить опросу изменений — выводится из `timestamps`:
 * новые строки — всегда, изменённые — есть `updatedAt`, удалённые — есть `deletedAt`.
 */
export interface LiveCapabilities {
  inserted: true;
  updated: boolean;
  deleted: boolean;
}
export interface ListInput {
  fields?: readonly string[];
  filter?: Filter;
  order?: Order;
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
  include?: readonly string[];
}
export interface CursorInput extends Omit<ListInput, "page"> {
  /** Токен из `nextCursor` прошлой страницы; `null`/нет — первая страница (DB-3). */
  after?: string | null;
}
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface ResourceApi<
  F extends Fields = Fields,
  R extends Relations = {},
> {
  select(ctx: DataContext, input?: ListInput): Promise<ResourceRow<F, R>[]>;
  get(
    ctx: DataContext,
    id: unknown,
    input?: Pick<ListInput, "fields" | "includeDeleted">,
  ): Promise<ResourceRow<F, R>>;
  count(
    ctx: DataContext,
    input?: Pick<ListInput, "filter" | "includeDeleted">,
  ): Promise<number>;
  cursor(
    ctx: DataContext,
    input?: CursorInput,
  ): Promise<CursorPage<ResourceRow<F, R>>>;
  insert(ctx: DataContext, input: unknown): Promise<ResourceRow<F, R>>;
  update(
    ctx: DataContext,
    id: unknown,
    patch: unknown,
  ): Promise<ResourceRow<F, R>>;
  /**
   * Удалить одну запись по правилу `delete`. У модели с мягким удалением — метка; `force: true`
   * — навсегда (удалённую строку достаёт только тот, кто видит удалённые). Ссылки на запись
   * других записей — ошибка базы (`conflict`, код `referenced`).
   */
  delete(ctx: DataContext, id: unknown, options?: { force?: boolean }): Promise<ResourceRow<F, R>>;
  /** Какие из записей этот ctx может удалить — без удаления; `soft` — удаление по умолчанию мягкое. */
  canDelete(ctx: DataContext, ids: readonly unknown[]): Promise<{ allowed: unknown[]; soft: boolean }>;
  /**
   * Снять метку мягкого удаления. Нужны право `readDeleted` (иначе `forbidden`) и
   * политика `restore` (нет — `delete`); строка не удалена или не видна — `not_found`.
   * Хукам записи это `update`. Без мягкого удаления — `unsupported`.
   */
  restore(ctx: DataContext, id: unknown): Promise<ResourceRow<F, R>>;
  /**
   * Проверка без записи как Standard Schema — для форм, которые ничего не пишут
   * (вход, сброс пароля): `createFormHandler({ schema: users.validator(ctx, 'check') })`.
   * Проверяет поля ресурса, которые есть во входе (чужие ключи формы пропускает), и
   * `checks`. `insert`/`update` — как настоящая запись: права на поля, у `insert` —
   * обязательные поля. `check` — только значения и `checks`, без прав и обязательности.
   * Ошибки — issues с `path: [поле]` и кодом; сбой БД — исключение, не issue.
   */
  validator(
    ctx: DataContext,
    operation: "insert" | "update" | "check",
  ): StandardSchemaV1<unknown, Row>;
  /**
   * Пакетная вставка одним `INSERT … VALUES (…), (…)`: проверка каждой строки идёт
   * тем же путём, что и у `insert`, но Round-trip один (на chunk). Хуки/`validateFinal`
   * с ним сочетаться не могут (проверка результата требует построчности) → `unsupported`.
   */
  insertMany(
    ctx: DataContext,
    rows: readonly unknown[],
    options?: {
      onConflictIgnore?: boolean;
      chunkSize?: number;
      /**
       * Больше одного чанка — только атомарно. На транспорте без транзакций
       * (`capabilities.transactions === false`) это `unsupported`, а не тихая
       * последовательная вставка.
       */
      atomic?: boolean;
    },
  ): Promise<ResourceRow<F, R>[]>;
  /**
   * Оценка числа строк для UI-пагинатора. Когда пользователю видна вся таблица
   * (нет фильтра, политика без условий, удалённые строки не скрыты) — статистика
   * планировщика (`reltuples`), иначе `Plan Rows` из `EXPLAIN` с предикатом политики
   * (без выполнения запроса). Проверки прав — как у `count`.
   * `exact: true` только когда посчитали реально.
   */
  estimate(
    ctx: DataContext,
    input?: Pick<ListInput, "filter" | "includeDeleted">,
  ): Promise<{ rows: number; exact: boolean; method: "reltuples" | "explain" | "count" }>;
  /**
   * Временный экземпляр без части автоматики: `fn` получает ту же модель, собранную из
   * описания с `null` по путям схемы (`'timestamps.updatedAt'`, `'policy'`, `'grants'`,
   * `'hooks'`, `'fields.*.store'`, `'protect'`, …). Остальной код модель не теряет. Путь,
   * которого у модели нет, — `validation`. Вложенный `without` складывает пути. Таблицу
   * клон не описывает: синхронизация схемы идёт только по исходной модели.
   */
  without<T>(paths: readonly string[], fn: (api: ResourceApi<F, R>) => T | Promise<T>): Promise<T>;
  /** Что модель делает сама и что у этого экземпляра выключено. */
  behavior(): ModelBehavior;
  /**
   * Сырой экземпляр: что передали, то и записано; чтение — все строки и поля, без хуков и
   * белых списков. Остаются имена полей → колонки (неизвестное — `validation`), параметры
   * SQL, транзакция, отмена. `cursor`, `restore`, `estimate`, `validator`, `include` —
   * `unsupported`.
   */
  raw<T>(fn: (api: ResourceApi<F, R>) => T | Promise<T>): Promise<T>;
}
/** Поведение модели (`behavior()`): метки времени, что умеет опрос, что выключено. */
export interface ModelBehavior {
  readonly timestamps: Readonly<{ createdAt?: string; updatedAt?: string; deletedAt?: string }>;
  readonly live: LiveCapabilities;
  /** Выключенные пути (`without`), по порядку. */
  readonly off: readonly string[];
  /** Сырой экземпляр (`raw`): выключено всё. */
  readonly raw: boolean;
}
export interface CursorCodec {
  encode(scope: unknown, values: readonly unknown[]): Promise<string>;
  decode(token: string, scope: unknown): Promise<readonly unknown[]>;
}
export interface Database {
  readonly driver: Driver;
  readonly limits: Readonly<Limits>;
  readonly cursorCodec?: CursorCodec;
  query<T extends Row = Row>(statement: Statement): Promise<QueryResult<T>>;
  resource<F extends Fields, R extends Relations = {}>(
    descriptor: Resource<F, R>,
  ): ResourceApi<F, R>;
  transaction<T>(
    fn: (tx: Database) => Promise<T>,
    options?: TxOptions,
  ): Promise<T>;
  afterCommit(fn: () => void | Promise<void>): Promise<void>;
  guard<T>(fn: () => Promise<T>): Promise<T>;
}
