import { DbFailure } from "../errors";
import type { Capabilities, Driver } from "../types";
import { transactionalCapabilities } from "./shared";

/**
 * Драйвер, который открывается при первом запросе, а не при создании.
 *
 * `createDb({ driver: lazyDriver(open) })` можно вызвать при загрузке модуля: объект базы
 * ничего не стоит, а `open()` (пул pg, PGlite, Hyperdrive, прокси — что угодно, что
 * возвращает `Driver`) выполняется один раз, когда кто-то впервые обратился к БД.
 * Страницы, которые БД не трогают, её не поднимают.
 *
 * - Параллельные первые запросы ждут одно и то же открытие.
 * - Неудачное открытие не запоминается: следующий запрос пробует снова (иначе одна
 *   заминка при старте — таймаут сети, холодный контейнер — становилась бы состоянием
 *   процесса до перезапуска).
 * - `capabilities` нужны сразу (`db.transaction` проверяет их до запроса), поэтому их
 *   объявляют заранее; по умолчанию — как у pg/PGlite/Hyperdrive. Если открытый драйвер
 *   умеет другое, запрос отказывает `unsupported`, а не работает «как получится».
 */
export function lazyDriver(
  open: () => Promise<Driver>,
  capabilities: Capabilities = transactionalCapabilities,
): Driver {
  if (typeof open !== "function") throw new Error("lazyDriver requires open()");
  let opened: Driver | undefined;
  let opening: Promise<Driver> | undefined;

  const same = (a: Capabilities, b: Capabilities) =>
    a.transactions === b.transactions &&
    a.savepoints === b.savepoints &&
    a.sqlstate === b.sqlstate &&
    a.isolationLevels.length === b.isolationLevels.length &&
    a.isolationLevels.every((level) => b.isolationLevels.includes(level));

  function driver(): Promise<Driver> {
    if (opened) return Promise.resolve(opened);
    opening ??= (async () => {
      try {
        const d = await open();
        if (!d || typeof d.query !== "function" || typeof d.transaction !== "function")
          throw new Error("lazyDriver: open() must resolve to a Driver");
        if (!same(d.capabilities, capabilities))
          throw new DbFailure("unsupported", {}, new Error("lazyDriver: declared capabilities differ from the opened driver"));
        opened = d;
        return d;
      } finally {
        opening = undefined;
      }
    })();
    return opening;
  }

  return {
    capabilities,
    async query(statement) {
      return (await driver()).query(statement);
    },
    async transaction(fn, options) {
      return (await driver()).transaction(fn, options);
    },
    /** Закрывает открытый драйвер; если открытия не было — ничего не поднимает. */
    async close() {
      const d = opened ?? (opening ? await opening.catch(() => undefined) : undefined);
      opened = undefined;
      await d?.close?.();
    },
  };
}
