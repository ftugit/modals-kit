import { variants, type VariantProps } from '../cn'

export const modalBackdropVariants = variants(
  'modal-backdrop fixed inset-0 z-200 transition-opacity duration-220 ease-out',
  {},
  {},
)

export const modalPopupVariants = variants(
  'modal-popup relative flex flex-col overflow-hidden outline-none',
  {
    openAnimation: {
      scale: 'modal-open-scale',
      'slide-up': 'modal-open-slide-up',
      fade: 'modal-open-fade',
      none: 'modal-open-none',
    },
    closeAnimation: {
      scale: 'modal-close-scale',
      'slide-down': 'modal-close-slide-down',
      fade: 'modal-close-fade',
      none: 'modal-close-none',
    },
    stackAnimation: {
      squeeze: 'modal-stack-squeeze',
      tail: 'modal-stack-tail',
      none: 'modal-stack-none',
    },
  },
  {
    openAnimation: 'scale',
    closeAnimation: 'scale',
    stackAnimation: 'squeeze',
  },
)

export const modalButtonVariants = variants(
  'modal-btn inline-flex items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variant: {
      default: 'border-border bg-card text-card-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
      quiet: 'modal-btn-quiet border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground',
      danger: 'modal-btn-danger border-destructive bg-destructive text-destructive-foreground hover:opacity-90',
    },
    size: {
      sm: 'h-8 px-3 text-xs',
      md: 'h-9 px-3.5 text-sm',
      lg: 'h-10 px-4 text-sm',
    },
  },
  {
    variant: 'default',
    size: 'md',
  },
)

export const modalTriggerVariants = variants(
  'modal-trigger inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium text-card-foreground shadow-xs transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:border-ring data-[state=error]:border-destructive data-[state=error]:text-destructive data-[state=loading]:opacity-85',
  {},
  {},
)

export type ModalButtonVariants = VariantProps<{
  variant: Record<'default' | 'quiet' | 'danger', string>
  size: Record<'sm' | 'md' | 'lg', string>
}>
