import { Bot, Loader2, Play, Power } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Backend } from '../backend'
import { useI18n } from '../i18n'
import { fmtDate as when } from '../theme'
import type { Automode, Channel, Lang } from '../types'
import { Toggle } from './ui'

const INTERVALS = [
  { minutes: 60, label: 'auto.hourly' },
  { minutes: 60 * 24, label: 'auto.daily' },
  { minutes: 60 * 24 * 7, label: 'auto.weekly' },
  { minutes: 60 * 24 * 30, label: 'auto.monthly' },
]

/** Auto mode: evaluates all stored supplier numbers on a schedule and notifies buyers. */
export function AutomodeControl({ api, onCycleFinished }: { api: NonNullable<Backend['automode']>; onCycleFinished: () => void }) {
  const { t } = useI18n()
  const [state, setState] = useState<Automode | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let wasRunning = false
    const load = async () => {
      try {
        const s = await api.get()
        if (wasRunning && !s.running) onCycleFinished()
        wasRunning = s.running
        setState(s)
      } catch {
        /* backend unreachable – shown elsewhere */
      }
    }
    load()
    api.channels().then(setChannels).catch(() => {})
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [api, onCycleFinished])

  const update = async (changes: Parameters<typeof api.set>[0]) => {
    try {
      setState(await api.set(changes))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const runNow = async () => {
    try {
      await api.run()
      setState((s) => (s ? { ...s, running: true } : s))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!state) return null
  const external = channels.filter((c) => c.id !== 'inapp')

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`glass flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-semibold ${state.enabled ? 'text-ink-1' : 'text-ink-3'}`}
        aria-expanded={open}
      >
        {state.running ? (
          <Loader2 size={15} className="spin text-accent" />
        ) : (
          <Power size={15} className={state.enabled ? 'text-good' : 'text-ink-3'} />
        )}
        <span className="hidden lg:inline">{t('auto.label', { state: t(state.enabled ? 'auto.on' : 'auto.off') })}</span>
      </button>
      {open && (
        <div className="glass absolute right-0 top-12 z-50 w-[min(340px,calc(100vw-24px))] rounded-2xl p-4 text-xs text-ink-2">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-1">
            <Bot size={16} className="text-accent" /> {t('auto.label', { state: '' })}
          </div>
          <p className="mb-3 text-ink-3">{t('auto.desc')}</p>
          <Toggle label={t('auto.enabled')} checked={state.enabled} onChange={(v) => update({ enabled: v })} />
          <label className="mt-2 flex items-center justify-between gap-3">
            {t('auto.interval')}
            <select
              value={state.interval_minutes}
              onChange={(e) => update({ interval_minutes: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-ink-1"
            >
              {INTERVALS.map((i) => (
                <option key={i.minutes} value={i.minutes}>
                  {t(i.label)}
                </option>
              ))}
              {!INTERVALS.some((i) => i.minutes === state.interval_minutes) && (
                <option value={state.interval_minutes}>{t('auto.every', { n: state.interval_minutes })}</option>
              )}
            </select>
          </label>
          <label className="mt-2 flex items-center justify-between gap-3">
            {t('auto.lang')}
            <select
              value={state.lang ?? 'de'}
              onChange={(e) => update({ lang: e.target.value as Lang })}
              className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-ink-1"
            >
              <option value="de">{t('lang.de')}</option>
              <option value="en">{t('lang.en')}</option>
            </select>
          </label>

          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 font-medium text-ink-1">{t('auto.channels')}</div>
            {external.map((c) => (
              <label key={c.id} className="flex items-center justify-between py-1">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.channels.includes(c.id)}
                    onChange={(e) =>
                      update({ channels: e.target.checked ? [...state.channels, c.id] : state.channels.filter((x) => x !== c.id) })
                    }
                  />
                  {c.name}
                </span>
                <span className={c.configured ? 'text-good' : 'text-ink-3'}>{c.configured ? t('auto.connected') : t('auto.not_configured')}</span>
              </label>
            ))}
            <div className="py-1 text-ink-3">{t('auto.cockpit_always')}</div>
          </div>

          <div className="mt-3 space-y-0.5 border-t border-line pt-3 text-ink-3">
            <div>{t('auto.last_run', { when: when(state.last_run) })}</div>
            {state.enabled && <div>{t('auto.next_run', { when: when(state.next_run) })}</div>}
            {state.last_result && (
              <div>
                {t('auto.result', {
                  suppliers: state.last_result.suppliers,
                  escalations: state.last_result.escalations,
                  sent: state.last_result.sent,
                })}
                {state.last_result.failed > 0 && <span className="text-[#ff8a8a]">{t('auto.failed', { n: state.last_result.failed })}</span>}
              </div>
            )}
          </div>
          {error && <div className="mt-2 text-[#ff8a8a]">{error}</div>}
          <button
            onClick={runNow}
            disabled={state.running}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-accent/50 px-3 py-2 font-semibold text-ink-1 hover:bg-accent/10 disabled:opacity-60"
          >
            {state.running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            {state.running ? t('auto.running') : t('auto.run')}
          </button>
        </div>
      )}
    </div>
  )
}
