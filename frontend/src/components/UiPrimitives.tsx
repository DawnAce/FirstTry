import type { KeyboardEvent, ReactNode } from 'react'
import { Card } from 'antd'
import './ui-primitives.css'

export type SemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'

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
