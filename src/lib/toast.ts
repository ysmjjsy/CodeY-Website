export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface ToastOptions {
  variant?: ToastVariant
  title?: string
  /**
   * Auto-dismiss delay in milliseconds. Use 0 to keep the toast open.
   */
  duration?: number
}

export interface ToastDetail extends ToastOptions {
  message: string
}

export const TOAST_EVENT = 'codey:toast'

export function showToast(message: string, options: ToastOptions = {}): void {
  if (typeof window === 'undefined' || !message.trim()) return

  const detail: ToastDetail = { ...options, message: message.trim() }
  const emit = () => window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail }))

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', emit, { once: true })
  } else {
    emit()
  }
}

type VariantOptions = Omit<ToastOptions, 'variant'>

export const toast = {
  show: showToast,
  success: (message: string, options?: VariantOptions) =>
    showToast(message, { ...options, variant: 'success' }),
  error: (message: string, options?: VariantOptions) =>
    showToast(message, { ...options, variant: 'error' }),
  warning: (message: string, options?: VariantOptions) =>
    showToast(message, { ...options, variant: 'warning' }),
  info: (message: string, options?: VariantOptions) =>
    showToast(message, { ...options, variant: 'info' }),
}
