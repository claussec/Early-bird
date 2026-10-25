import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { RISK, STATUS } from '../theme'
import type { Light, RiskStatus } from '../types'

const ICONS = { green: CheckCircle2, yellow: AlertTriangle, red: AlertOctagon }

/** Traffic-light status: always icon + label, never color alone. */
export function StatusBadge({ light, size = 'md', children }: { light: Light; size?: 'sm' | 'md'; children?: ReactNode }) {
  const Icon = ICONS[light]
  const { color, label } = STATUS[light]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ borderColor: `${color}66`, background: `${color}1f`, color: '#f0efec' }}
    >
      <Icon size={size === 'sm' ? 12 : 14} color={color} strokeWidth={2.4} />
      {children ?? label}
    </span>
  )
}

export function StatusIcon({ light, size = 14 }: { light: Light; size?: number }) {
  const Icon = ICONS[light]
  return <Icon size={size} color={STATUS[light].color} strokeWidth={2.4} aria-label={STATUS[light].label} />
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-accent/70 bg-accent/15 text-ink-1'
          : 'border-line bg-surface-2/60 text-ink-3 hover:border-ink-3/40 hover:text-ink-2'
      }`}
    >
      {children}
    </button>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs text-ink-2">
      {label}
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

/** Result of the agents: Risk? / Escalation?, with icon and label. */
export function RiskBadge({ status, size = 'md' }: { status: RiskStatus; size?: 'sm' | 'md' }) {
  return (
    <StatusBadge light={RISK[status].light} size={size}>
      {RISK[status].label}
    </StatusBadge>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}
