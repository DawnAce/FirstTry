import type { KeyboardEvent, ReactNode } from 'react'
import { Card } from 'antd'
import './ui-primitives.css'

export type SemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'

type SuccessCheckIconProps = {
  className?: string
}

export function SuccessCheckIcon({ className = '' }: SuccessCheckIconProps) {
  return (
    <svg
      className={`ui-success-check-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  )
}

type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  leading?: ReactNode
}

export function PageHeader({ title, description, actions, leading }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      {leading && <div className="ui-page-header-leading">{leading}</div>}
      <div className="ui-page-header-copy">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-page-header-actions">{actions}</div>}
    </header>
  )
}

type StatusPillProps = {
  children: ReactNode
  tone?: SemanticTone
  icon?: ReactNode
  dot?: boolean
  className?: string
}

export function StatusPill({ children, tone = 'neutral', icon, dot = !icon, className = '' }: StatusPillProps) {
  return (
    <span className={`ui-status-pill ui-tone-${tone} ${className}`.trim()}>
      {icon ?? (dot ? <span className="ui-status-pill-dot" aria-hidden /> : null)}
      {children}
    </span>
  )
}

type DrawerTitleProps = {
  title: ReactNode
  description?: ReactNode
  icon: ReactNode
  status?: ReactNode
  tone?: SemanticTone
}

export function DrawerTitle({ title, description, icon, status, tone = 'info' }: DrawerTitleProps) {
  return (
    <div className={`ui-drawer-title ui-tone-${tone}`}>
      <span className="ui-drawer-title-icon" aria-hidden>{icon}</span>
      <div className="ui-drawer-title-copy">
        <strong>{title}</strong>
        {description && <div>{description}</div>}
      </div>
      {status && <div className="ui-drawer-title-status">{status}</div>}
    </div>
  )
}

type MetricCardProps = {
  label: ReactNode
  value: ReactNode
  suffix?: ReactNode
  icon?: ReactNode
  note?: ReactNode
  tone?: SemanticTone
  noteTone?: SemanticTone
  loading?: boolean
  onClick?: () => void
}

export function MetricCard({
  label,
  value,
  suffix,
  icon,
  note,
  tone = 'info',
  noteTone,
  loading,
  onClick,
}: MetricCardProps) {
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (onClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <Card
      size="small"
      loading={loading}
      className={`ui-metric-card ui-tone-${tone}${onClick ? ' ui-metric-card-clickable' : ''}`}
      onClick={onClick}
      onKeyDown={activate}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="ui-metric-card-inner">
        {icon && <span className="ui-metric-card-icon" aria-hidden>{icon}</span>}
        <div className="ui-metric-card-copy">
          <div className="ui-metric-card-label">{label}</div>
          <div className="ui-metric-card-value">{value}{suffix && <small>{suffix}</small>}</div>
          {note && <div className={`ui-metric-card-note${noteTone ? ` ui-tone-text-${noteTone}` : ''}`}>{note}</div>}
        </div>
      </div>
    </Card>
  )
}
