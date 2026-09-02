import React from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useToasts } from '../../store/toasts'

const icons = {
  info: <Info size={16} className="text-info" />,
  warn: <AlertTriangle size={16} className="text-warning" />,
  error: <XCircle size={16} className="text-danger" />,
  success: <CheckCircle2 size={16} className="text-success" />
}

export function Toasts(): React.JSX.Element {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[380px] max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'card px-3.5 py-3 flex items-start gap-3 shadow-xl border-l-4',
            t.level === 'error'
              ? 'border-l-danger'
              : t.level === 'warn'
                ? 'border-l-warning'
                : t.level === 'success'
                  ? 'border-l-success'
                  : 'border-l-info'
          )}
        >
          <div className="mt-0.5 shrink-0">{icons[t.level]}</div>
          <div className="text-[13px] grow break-words">{t.message}</div>
          {t.undo && (
            <button
              className="text-accent text-[13px] font-semibold shrink-0 hover:underline"
              onClick={() => {
                t.undo?.()
                dismiss(t.id)
              }}
            >
              Undo
            </button>
          )}
          <button
            className="text-faint hover:text-text shrink-0"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
