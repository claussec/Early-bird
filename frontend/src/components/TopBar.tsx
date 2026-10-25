import { Bell, Bot, Loader2, Radar, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { backend } from '../backend'
import { RISK, RISK_ORDER } from '../theme'
import type { Meta, Notification, RiskStatus, Supplier } from '../types'
import { AgentModeControl } from './AgentModeControl'
import { AutomodeControl } from './AutomodeControl'
import { StatusIcon } from './ui'

const CHANNEL_LABEL: Record<string, string> = { inapp: 'Cockpit', outlook: 'Outlook', teams: 'Teams' }

interface Props {
  meta: Meta | null
  suppliers: Supplier[]
  notifications: Notification[]
  cycle: { running: boolean; done: number; total: number; current: string }
  onCycle: () => void
  onSelect: (id: string) => void
  onAutomodeFinished: () => void
}

export function TopBar({ meta, suppliers, notifications, cycle, onCycle, onSelect, onAutomodeFinished }: Props) {
  const [open, setOpen] = useState(false)
  const count = (st: RiskStatus) => suppliers.filter((s) => s.status === st).length
  const inbox = notifications.filter((n) => n.channel === 'inapp')

  return (
    <header className="pointer-events-auto flex flex-wrap items-center gap-3">
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#3987e5] to-[#1c5cab]">
          <Radar size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold leading-tight text-ink-1">Supplier Risk Radar</h1>
          <p className="hidden text-[11px] leading-tight text-ink-3 sm:block">KI-Frühwarnsystem für finanziell kritische Lieferanten</p>
        </div>
      </div>

      <div className="glass hidden items-center gap-4 rounded-2xl px-4 py-3 text-sm sm:flex">
        {RISK_ORDER.map((st) => (
          <span key={st} className="flex items-center gap-1.5 text-xs text-ink-3" title={RISK[st].hint}>
            <StatusIcon light={RISK[st].light} size={15} />
            <b className="font-mono text-sm text-ink-1">{count(st)}</b>
            <span className="hidden lg:inline">{RISK[st].label}</span>
          </span>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        {meta && !backend.agents && (
          <div
            className="glass hidden items-center gap-2 rounded-2xl px-3 py-2.5 text-xs text-ink-2 md:flex"
            title="LLM-Provider (LLM_PROVIDER)"
          >
            <Bot size={15} className="text-accent" /> {meta.llm}
          </div>
        )}
        {backend.agents && <AgentModeControl agents={backend.agents} />}
        {backend.automode && <AutomodeControl api={backend.automode} onCycleFinished={onAutomodeFinished} />}
        <button
          onClick={onCycle}
          disabled={cycle.running}
          title={backend.target === 'artifact' ? 'Bewertet alle Lieferanten regelbasiert (ohne Claude-Kontingent)' : undefined}
          className="glass flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold text-ink-1 transition hover:border-accent/60 disabled:opacity-80"
        >
          {cycle.running ? <Loader2 size={15} className="spin text-accent" /> : <RefreshCw size={15} className="text-accent" />}
          <span className={cycle.running ? '' : 'hidden sm:inline'}>
            {cycle.running ? `${cycle.done}/${cycle.total}` : backend.target === 'artifact' ? 'Alle prüfen' : 'Quartalslauf starten'}
          </span>
          {cycle.running && <span className="hidden sm:inline">· {cycle.current}</span>}
        </button>
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="glass relative rounded-2xl p-2.5 text-ink-2 hover:text-ink-1"
            aria-label="Benachrichtigungen"
          >
            <Bell size={18} />
            {inbox.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-crit px-1 font-mono text-[10px] font-semibold text-white">
                {inbox.length}
              </span>
            )}
          </button>
          {open && (
            <div className="glass scroll-thin absolute right-0 top-12 z-50 max-h-[60vh] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-2xl p-2">
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                Benachrichtigungen an Einkäufer
              </div>
              {notifications.map((n, i) => (
                <button
                  key={n.id ?? i}
                  onClick={() => {
                    onSelect(n.supplier_id)
                    setOpen(false)
                  }}
                  className="block w-full rounded-xl px-2 py-2 text-left hover:bg-white/5"
                >
                  <div className="text-[13px] font-medium text-ink-1">{n.subject}</div>
                  <div className="text-[11px] text-ink-3">
                    {CHANNEL_LABEL[n.channel] ?? n.channel} · an {n.recipient} · {new Date(n.created_at).toLocaleString('de-DE')}
                    {n.status === 'failed' && (
                      <span className="text-[#ff8a8a]" title={n.error}>
                        {' '}
                        · fehlgeschlagen
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {!notifications.length && <div className="px-2 py-4 text-xs text-ink-3">Keine Benachrichtigungen.</div>}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export function Legend() {
  return (
    <div className="glass pointer-events-auto hidden items-center gap-5 rounded-2xl px-4 py-2.5 text-[11px] text-ink-3 lg:flex">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-2 rounded-sm bg-ink-3/60" /> Höhe = Einkaufsvolumen
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-[#9ec5f4]" /> Ring = Customer-Share
        <span className="inline-block h-3 w-3 rounded-full border-2 border-[#ff8a5c]" /> ≥ 50 %
      </span>
      <span className="flex items-center gap-1.5">
        <StatusIcon light="green" size={12} /> Kein Risiko
        <StatusIcon light="yellow" size={12} /> Risiko erkannt
        <StatusIcon light="red" size={12} /> Eskaliert
      </span>
      <span>◆ Pulsieren = eskaliert</span>
      <span>Ziehen = drehen · Scrollen = zoomen</span>
    </div>
  )
}
