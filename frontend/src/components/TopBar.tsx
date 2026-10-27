import { Bell, Bot, Factory, List, Loader2, Map as MapIcon, Radar, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { backend } from '../backend'
import { useI18n } from '../i18n'
import { RISK, RISK_ORDER, fmtDate } from '../theme'
import type { Meta, Notification, RiskStatus, Supplier } from '../types'
import { AgentModeControl } from './AgentModeControl'
import { AutomodeControl } from './AutomodeControl'
import { LangSwitch, StatusIcon } from './ui'

export type View = 'map' | 'radar' | 'list'

interface Props {
  meta: Meta | null
  suppliers: Supplier[]
  notifications: Notification[]
  cycle: { running: boolean; done: number; total: number; current: string }
  view: View
  onView: (v: View) => void
  onCycle: () => void
  onSelect: (id: string) => void
  onPlants: () => void
  onAutomodeFinished: () => void
}

export function TopBar({ meta, suppliers, notifications, cycle, view, onView, onCycle, onSelect, onPlants, onAutomodeFinished }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const count = (st: RiskStatus) => suppliers.filter((s) => s.status === st).length
  const inbox = notifications.filter((n) => n.channel === 'inapp')
  const browser = backend.target !== 'server'

  return (
    <header className="pointer-events-auto flex flex-wrap items-center gap-2 md:gap-3">
      <div className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#3987e5] to-[#1c5cab]">
          <Radar size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold leading-tight text-ink-1">Supplier Risk Radar</h1>
          <p className="hidden text-[11px] leading-tight text-ink-3 sm:block">{t('app.tagline')}</p>
        </div>
      </div>

      <div className="glass hidden items-center gap-4 rounded-2xl px-4 py-3 text-sm lg:flex">
        {RISK_ORDER.map((st) => (
          <span key={st} className="flex items-center gap-1.5 text-xs text-ink-3" title={t(`risk.${st}.hint`)}>
            <StatusIcon light={RISK[st].light} size={15} />
            <b className="font-mono text-sm text-ink-1">{count(st)}</b>
            <span className="hidden min-[1700px]:inline">{t(`risk.${st}`)}</span>
          </span>
        ))}
      </div>

      <ViewSwitch view={view} onView={onView} />

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 md:gap-3">
        <LangSwitch />
        {meta && !backend.agents && (
          <div className="glass hidden items-center gap-2 rounded-2xl px-3 py-2.5 text-xs text-ink-2 min-[1800px]:flex" title={t('top.llm_title')}>
            <Bot size={15} className="text-accent" /> {meta.provider === 'demo' ? t('agents.rules') : meta.llm}
          </div>
        )}
        {backend.agents && <AgentModeControl agents={backend.agents} />}
        {backend.automode && <AutomodeControl api={backend.automode} onCycleFinished={onAutomodeFinished} />}
        <button
          onClick={onPlants}
          className="glass flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-semibold text-ink-1 transition hover:border-accent/60"
          title={t('plants.title')}
        >
          <Factory size={15} className="text-accent" />
          <span className="hidden sm:inline">{t('top.plants')}</span>
        </button>
        <button
          onClick={onCycle}
          disabled={cycle.running}
          title={browser ? t('top.check_all_title') : undefined}
          className="glass flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-semibold text-ink-1 transition hover:border-accent/60 disabled:opacity-80"
        >
          {cycle.running ? <Loader2 size={15} className="spin text-accent" /> : <RefreshCw size={15} className="text-accent" />}
          <span className={cycle.running ? '' : 'hidden lg:inline'}>
            {cycle.running ? `${cycle.done}/${cycle.total}` : browser ? t('top.check_all') : t('top.cycle')}
          </span>
          {cycle.running && <span className="hidden sm:inline">· {cycle.current}</span>}
        </button>
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="glass relative rounded-2xl p-2.5 text-ink-2 hover:text-ink-1"
            aria-label={t('top.notifications')}
          >
            <Bell size={18} />
            {inbox.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-crit px-1 font-mono text-[10px] font-semibold text-white">
                {inbox.length}
              </span>
            )}
          </button>
          {open && (
            <div className="glass scroll-thin absolute right-0 top-12 z-50 max-h-[60vh] w-[min(400px,calc(100vw-32px))] overflow-y-auto rounded-2xl p-2">
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{t('top.notifications_title')}</div>
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
                  {n.plants && n.plants.length > 0 && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-2">
                      <Factory size={11} /> {n.plants.join(', ')}
                    </div>
                  )}
                  <div className="text-[11px] text-ink-3">
                    {t(`channel.${n.channel}`)} · {t('top.to', { recipient: n.recipient })} · {fmtDate(n.created_at)}
                    {n.status === 'failed' && (
                      <span className="text-[#ff8a8a]" title={n.error}>
                        {' '}
                        · {t('top.failed')}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {!notifications.length && <div className="px-2 py-4 text-xs text-ink-3">{t('top.no_notifications')}</div>}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function ViewSwitch({ view, onView }: { view: View; onView: (v: View) => void }) {
  const { t } = useI18n()
  const views: { id: View; icon: typeof MapIcon }[] = [
    { id: 'map', icon: MapIcon },
    { id: 'radar', icon: Radar },
    { id: 'list', icon: List },
  ]
  return (
    <div className="glass flex items-center gap-0.5 rounded-2xl p-1" role="group" aria-label={t('view.label')}>
      {views.map((v) => (
        <button
          key={v.id}
          onClick={() => onView(v.id)}
          aria-pressed={view === v.id}
          title={t(`view.${v.id}`)}
          className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold ${
            view === v.id ? 'bg-accent/20 text-ink-1' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          <v.icon size={14} />
          <span className="hidden md:inline">{t(`view.${v.id}`)}</span>
        </button>
      ))}
    </div>
  )
}

export function Legend({ view }: { view: View }) {
  const { t } = useI18n()
  if (view === 'list') return null
  return (
    <div className="glass pointer-events-auto hidden items-center gap-5 rounded-2xl px-4 py-2.5 text-[11px] text-ink-3 lg:flex">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-2 rounded-sm bg-ink-3/60" /> {t('legend.height')}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-[#9ec5f4]" /> {t('legend.ring')}
        <span className="inline-block h-3 w-3 rounded-full border-2 border-[#ff8a5c]" /> ≥ 50 %
      </span>
      <span className="flex items-center gap-1.5">
        <StatusIcon light="green" size={12} /> {t('risk.none')}
        <StatusIcon light="yellow" size={12} /> {t('risk.risk')}
        <StatusIcon light="red" size={12} /> {t('risk.escalated')}
      </span>
      {view === 'map' && <span>{t('legend.arcs')}</span>}
      <span>{t('legend.pulse')}</span>
      <span>{t('legend.controls')}</span>
    </div>
  )
}
