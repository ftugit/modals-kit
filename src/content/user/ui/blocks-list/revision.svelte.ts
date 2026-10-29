/**
 * Реактивный счётчик ревизии списка блокировок: дочерние модалки создания,
 * редактирования и удаления инкрементируют его по завершении, чтобы открытый
 * под ними `BlocksList` сразу перечитал срез без перезагрузки страницы.
 */
let revision = $state(0)

export function getBlocksRevision(): number {
  return revision
}

export function bumpBlocksRevision(): void {
  revision += 1
}
