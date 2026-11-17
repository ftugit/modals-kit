// WebDAV — две стороны одного протокола, разведённые по модулям:
// - `./webdav/protocol.js` — общие примитивы (пути, XML, заголовки, ETag);
// - `./webdav/client.js`   — клиентский драйвер хранилища (`webdavDriver`);
// - `./webdav/server.js`   — серверный обработчик `Request → Response` (`createWebdavServer`).
//
// Вход `#core/lib/storage/webdav.js` остаётся единой публичной точкой, поэтому
// существующие импорты (`app-storage.server.ts`, формы, проба) не меняются.

export * from './webdav/client.js'
export * from './webdav/protocol.js'
// Серверный обработчик (`createWebdavServer`, `memoryDavBackend`, …) живёт в
// отдельном входе `#core/lib/storage/webdav/server.js` (см. entrypoints.json):
// он серверно-специфичен и не должен тянуться в клиентский бандл.
