# `#core/lib/drive` — чистое ядро «Диска»

Доменные функции модуля «Диск» (`docs/plan-drive.md`, этап 1). Пакет не знает ни
БД, ни Svelte, ни `node:*`: его импортируют серверный модуль `src/modules/drive`,
UI-слой и будущий `driveDavBackend`. Единственный вход — `#core/lib/drive/index.js`.

| Файл | Содержимое |
|---|---|
| `types.ts` | `DriveNodeView`, `DriveEntry`, `DriveSlice`, `DriveCapabilities`, `DriveQuotaView`, `DriveShareRole` |
| `names.ts` | `normalizeDriveName`, `checkDriveName`, `assertDriveName`, `driveNameKey` (NFC, 1…255 кодовых точек, запреты Windows) |
| `paths.ts` | `driveStoragePath` (`drive/<owner>/<node>`), `driveJoin`, `driveBreadcrumbs` |
| `tree.ts` | `collectSubtreeIds`, `collectTrashedIds`, `canMove`, `restorePlan` |
| `quota.ts` | `remainingQuota`, `checkQuota`, `assertQuota`, `formatBytes` |
| `listing.ts` | `DRIVE_SORTS`, `driveSortValue`, `encodeDriveCursor`/`decodeDriveCursor`, `compareDriveEntries`, `isAfterDriveCursor` |

Инварианты, которые держит ядро:

- имя сравнивается по `driveNameKey` (регистронезависимо); нормализация — до БД,
  иначе `NFC`/`NFD`-двойники проходят мимо уникального индекса;
- переименование не трогает байты: `fileId` — `drive/<owner_id>/<node_id>`;
- перенос не создаёт цикл и не уходит к чужому владельцу;
- квота считается по логическому `size`, а не по физическим частям;
- курсор всегда содержит `id`, поэтому ничьи на границе порции не теряются.

Проверки: `vitest run src/core/lib/drive`, `node tooling/core-purity.mjs`,
`node tooling/public-api.mjs`.
