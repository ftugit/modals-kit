import Attachment, { type AttachmentProps } from './Attachment.svelte'
import AttachmentAction, { type AttachmentActionProps } from './AttachmentAction.svelte'

export {
  Attachment,
  AttachmentAction,
  type AttachmentActionProps,
  type AttachmentProps,
}

export {
  ATTACHMENT_KIND_LABELS,
  ATTACHMENT_STATE_LABELS,
  clampProgress,
  formatAttachmentBytes,
  inferAttachmentKind,
  normalizeAttachment,
  selectedItemsByValues,
  toAttachmentOption,
  toggleAttachmentValue,
  type AttachmentItem,
  type AttachmentKind,
  type AttachmentLayout,
  type AttachmentMediaMode,
  type AttachmentOption,
  type AttachmentProgressVariant,
  type AttachmentSelectionMode,
  type AttachmentSize,
  type AttachmentState,
  type NormalizeAttachmentInput,
  type NormalizedAttachment,
} from './model.js'

export {
  attachmentIconSize,
  attachmentMediaVariants,
  attachmentRowMediaSize,
  attachmentRowSpacing,
  attachmentTileIconSize,
  attachmentTileSize,
  attachmentVariants,
  type AttachmentVariants,
} from './variants.js'
