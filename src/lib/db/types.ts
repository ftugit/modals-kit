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
  read: Grant;
  create?: Grant;
  update?: Grant;
  generated?: boolean;
  immutable?: boolean;
  required?: boolean;
  nullable?: boolean;
  normalize?: (v: unknown) => unknown;
  createValue?: (ctx: DataContext) => unknown;
  filters?: readonly Operator[];
  orderable?: boolean;
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
  policy: {
    select: (ctx: DataContext) => Filter;
    insert: (ctx: DataContext) => boolean;
    update: (ctx: DataContext) => Filter;
    delete: (ctx: DataContext) => Filter;
  };
  order: Order;
  hooks?: Hooks;
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
  };
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
  after?: string;
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
  delete(ctx: DataContext, id: unknown): Promise<ResourceRow<F, R>>;
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
   * Оценка числа строк для UI-пагинатора: без фильтра — статистика планировщика
   * (`reltuples`), с фильтром — `Plan Rows` из `EXPLAIN` (без выполнения запроса).
   * `exact: true` только когда посчитали реально.
   */
  estimate(
    ctx: DataContext,
    input?: Pick<ListInput, "filter" | "includeDeleted">,
  ): Promise<{ rows: number; exact: boolean; method: "reltuples" | "explain" | "count" }>;
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
