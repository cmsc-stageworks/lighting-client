/* eslint-disable react/prop-types */
import React, { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import * as RadixSwitch from '@radix-ui/react-switch'
import * as RadixSlider from '@radix-ui/react-slider'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import * as RadixDialog from '@radix-ui/react-dialog'
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import type { Tone } from '../../lib/format'

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: React.ReactNode
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-[#04141c] hover:bg-accent-strong border-transparent font-semibold',
  secondary: 'bg-surface-2 text-text hover:bg-surface-3 border-border-strong',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2 border-transparent',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border-danger/40',
  success: 'bg-success/15 text-success hover:bg-success/25 border-success/40',
  warning: 'bg-warning/15 text-warning hover:bg-warning/25 border-warning/40'
}
const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-10 px-3.5 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2.5'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-[10px] border transition-colors select-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" size={16} /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  size = 'md',
  ...rest
}: ButtonProps & { label: string }): React.JSX.Element {
  return (
    <Tooltip content={label}>
      <Button
        aria-label={label}
        size={size}
        className={clsx(
          '!px-0',
          size === 'sm' ? 'w-8' : size === 'lg' ? 'w-12' : 'w-10',
          className
        )}
        {...rest}
      />
    </Tooltip>
  )
}

// ---------------------------------------------------------------- Pill / Badge

const toneClass: Record<Tone, string> = {
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  info: 'bg-info/15 text-info border-info/30',
  accent: 'bg-accent/15 text-accent border-accent/30',
  muted: 'bg-surface-2 text-muted border-border'
}
const dotClass: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
  muted: 'bg-faint'
}

export function Pill({
  tone,
  children,
  dot = true,
  pulse,
  className,
  ...rest
}: {
  tone: Tone
  dot?: boolean
  pulse?: boolean
} & React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] font-semibold tracking-wide',
        toneClass[tone],
        className
      )}
      {...rest}
    >
      {dot && (
        <span className={clsx('w-2 h-2 rounded-full', dotClass[tone], pulse && 'pulse-ring')} />
      )}
      {children}
    </span>
  )
}

export function Badge({
  tone = 'muted',
  children,
  className
}: {
  tone?: Tone
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={clsx(
        'inline-flex items-center h-5 px-1.5 rounded-md border text-[11px] font-semibold',
        toneClass[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }): React.JSX.Element {
  return (
    <span
      className={clsx(
        'inline-block w-2.5 h-2.5 rounded-full',
        dotClass[tone],
        pulse && 'pulse-ring'
      )}
    />
  )
}

// ---------------------------------------------------------------- Card & layout

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={clsx('card p-4', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({
  children,
  action,
  className
}: {
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={clsx('flex items-center justify-between gap-3 mb-3', className)}>
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted mt-0.5 text-[13px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
  icon
}: {
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  icon?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="card border-dashed p-8 text-center flex flex-col items-center gap-2">
      {icon && <div className="text-faint mb-1">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {body && <div className="text-muted text-[13px] max-w-md">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- Form controls

export function Field({
  label,
  hint,
  error,
  children,
  className,
  inline
}: {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  children: React.ReactNode
  className?: string
  inline?: boolean
}): React.JSX.Element {
  return (
    <div className={clsx(inline ? 'flex items-center justify-between gap-4' : 'block', className)}>
      {label && <label className={clsx('field-label', inline && 'mb-0')}>{label}</label>}
      <div className={clsx(inline && 'shrink-0')}>{children}</div>
      {hint && !error && <div className="text-faint text-[12px] mt-1">{hint}</div>}
      {error && <div className="text-danger text-[12px] mt-1">{error}</div>}
    </div>
  )
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx('input', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
})

export function TextArea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return <textarea className={clsx('input', className)} {...rest} />
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
  ...rest
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    // Adjust local text when the controlled value changes (React's recommended pattern).
    setPrevValue(value)
    setText(String(value))
  }
  return (
    <input
      type="number"
      className={clsx('input mono', className)}
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && !Number.isNaN(n)) {
          let v = n
          if (min != null) v = Math.max(min, v)
          if (max != null) v = Math.min(max, v)
          onChange(v)
        }
      }}
      onBlur={() => setText(String(value))}
      {...rest}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
  className,
  placeholder,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; disabled?: boolean }[]
  className?: string
  placeholder?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className={clsx('relative', className)}>
      <select
        className="input appearance-none pr-9 cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
      />
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="inline-flex items-center gap-2.5">
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className={clsx(
          'w-11 h-6 rounded-full relative transition-colors border',
          checked ? 'bg-accent border-accent' : 'bg-surface-3 border-border-strong',
          disabled && 'opacity-50'
        )}
      >
        <RadixSwitch.Thumb
          className={clsx(
            'block w-5 h-5 rounded-full bg-white shadow transition-transform translate-x-0.5',
            checked && 'translate-x-[22px]'
          )}
        />
      </RadixSwitch.Root>
      {label && (
        <label htmlFor={id} className="text-sm cursor-pointer">
          {label}
        </label>
      )}
    </div>
  )
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  className,
  onCommit,
  disabled
}: {
  value: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <RadixSlider.Root
      className={clsx('relative flex w-full items-center select-none touch-none h-6', className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(v[0])}
      onValueCommit={(v) => onCommit?.(v[0])}
    >
      <RadixSlider.Track className="bg-surface-3 relative grow rounded-full h-2">
        <RadixSlider.Range className="absolute bg-accent rounded-full h-full" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="block w-5 h-5 bg-white rounded-full shadow border border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
    </RadixSlider.Root>
  )
}

export function Checkbox({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
      <span
        className={clsx(
          'w-5 h-5 rounded-md border flex items-center justify-center',
          checked ? 'bg-accent border-accent text-[#04141c]' : 'border-border-strong bg-surface-2'
        )}
        onClick={() => onChange(!checked)}
      >
        {checked && <Check size={14} strokeWidth={3} />}
      </span>
      <span onClick={() => onChange(!checked)}>{label}</span>
    </label>
  )
}

// ---------------------------------------------------------------- Tooltip

export function Tooltip({
  content,
  children,
  side = 'top'
}: {
  content: React.ReactNode
  children: React.ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
}): React.JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={400}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className="z-50 max-w-xs rounded-lg border border-border bg-surface-3 px-2.5 py-1.5 text-[12px] text-text shadow-lg"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}

// ---------------------------------------------------------------- Inline confirm

export function InlineConfirm({
  label = 'Delete',
  question = 'Delete?',
  onConfirm,
  variant = 'danger',
  size = 'sm',
  icon,
  className
}: {
  label?: React.ReactNode
  question?: string
  onConfirm: () => void
  variant?: Variant
  size?: Size
  icon?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  if (!asking) {
    return (
      <Button
        variant={variant}
        size={size}
        icon={icon}
        className={className}
        onClick={(e) => {
          e.stopPropagation()
          setAsking(true)
          timer.current = setTimeout(() => setAsking(false), 4000)
        }}
      >
        {label}
      </Button>
    )
  }
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[12px] text-muted">{question}</span>
      <Button
        variant="danger"
        size={size}
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        Yes
      </Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>
        No
      </Button>
    </span>
  )
}

// ---------------------------------------------------------------- Modal / Drawer

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  footer
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  width?: string
  footer?: React.ReactNode
}): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={clsx(
            'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-h-[90vh] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl focus:outline-none',
            width
          )}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <RadixDialog.Title className="font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button className="text-muted hover:text-text p-1 rounded-md" aria-label="Close">
                <X size={18} />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="px-5 py-4 overflow-y-auto grow">{children}</div>
          {footer && (
            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

// ---------------------------------------------------------------- Tabs (simple)

export function Tabs({
  tabs,
  value,
  onChange,
  className
}: {
  tabs: { value: string; label: React.ReactNode; badge?: React.ReactNode }[]
  value: string
  onChange: (v: string) => void
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1 p-1 rounded-xl bg-surface-2 border border-border',
        className
      )}
      role="tablist"
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'h-8 px-3 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors',
            value === t.value ? 'bg-surface-3 text-text shadow-sm' : 'text-muted hover:text-text'
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Search

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={clsx('relative', className)}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8"
      />
      {value && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return <Loader2 className="animate-spin text-muted" size={size} />
}

export function KeyValue({
  items
}: {
  items: { k: React.ReactNode; v: React.ReactNode }[]
}): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <dt className="text-muted">{it.k}</dt>
          <dd className="min-w-0 break-words">{it.v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export function Callout({
  tone = 'info',
  children,
  className
}: {
  tone?: Tone
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={clsx('rounded-xl border px-3.5 py-2.5 text-[13px]', toneClass[tone], className)}
    >
      {children}
    </div>
  )
}
