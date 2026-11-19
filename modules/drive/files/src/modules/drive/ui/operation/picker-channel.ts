export const DRIVE_PICKER_CHANNEL_PREFIX = 'picker:drive.target:'

/** Канал на параметр (`target_id`), как в контракте плана §2.6. */
export function drivePickerChannel(param: string): string {
  return `${DRIVE_PICKER_CHANNEL_PREFIX}${param}`
}

export interface DriveTargetPicked {
  readonly seq: number
  readonly id: string | null
  readonly label: string
}
