import { AlertOctagon, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import { RISK, STATUS } from '../theme'
import type { Light, RiskStatus } from '../types'

const ICONS = { green: CheckCircle2, yellow: AlertTriangle, red: AlertOctagon }

/** Traffic-light status: always icon + label, never color alone. */
export function StatusBadge({ light, size = 'md', children }: { light: Light; size?: 'sm' | 'md'; children?: ReactNode }) {
  const Icon = ICONS[light]
  const { t } = useI18n()
  const { color } = STATUS[light]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}
      style={{ borderColor: `${color}66`, background: `${color}1f`, color: '#f0efec' }}
    >
      <Icon size={size === 'sm' ? 12 : 14} color={color} strokeWidth={2.4} />
      {children ?? t(`light.${light}`)}
    </span>
  )
}

export function StatusIcon({ light, size = 14 }: { light: Light; size?: number }) {
  const Icon = ICONS[light]
  const { t } = useI18n()
  return <Icon size={size} color={STATUS[light].color} strokeWidth={2.4} aria-label={t(`light.${light}`)} />
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
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
        type="button"
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
  const { t } = useI18n()
  return (
    <StatusBadge light={RISK[status].light} size={size}>
      {t(`risk.${status}`)}
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

/** DE / EN switch with flag icons. */
export function LangSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <div className="glass flex items-center gap-0.5 rounded-2xl p-1" role="group" aria-label={t('lang.label')}>
      {(['de', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          title={t(`lang.${l}`)}
          className={`flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px] font-semibold ${
            lang === l ? 'bg-accent/20 text-ink-1' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {l === 'de' ? <FlagDE /> : <FlagGB />}
          <span className="hidden sm:inline">{l.toUpperCase()}</span>
        </button>
      ))}
    </div>
  )
}

function FlagDE() {
  return (
    <svg width="18" height="12" viewBox="0 0 5 3" className="rounded-[2px]" aria-hidden>
      <rect width="5" height="1" y="0" fill="#000" />
      <rect width="5" height="1" y="1" fill="#dd0000" />
      <rect width="5" height="1" y="2" fill="#ffce00" />
    </svg>
  )
}

function FlagGB() {
  return (
    <svg width="18" height="12" viewBox="0 0 60 30" className="rounded-[2px]" aria-hidden>
      <clipPath id="gb-s">
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id="gb-t">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath="url(#gb-s)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#gb-t)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  )
}
