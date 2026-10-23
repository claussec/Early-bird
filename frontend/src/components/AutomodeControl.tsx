import { Bot, Loader2, Play, Power } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Automode, Channel } from '../types'
import { Toggle } from './ui'

const INTERVALS = [
  { minutes: 60, label: 'stündlich' },
  { minutes: 60 * 24, label: 'täglich' },
  { minutes: 60 * 24 * 7, label: 'wöchentlich' },
  { minutes: 60 * 24 * 30, label: 'monatlich' },
]

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–')

/** Auto mode: evaluates all stored supplier numbers on a schedule and notifies buyers. */
export function AutomodeControl({ onCycleFinished }: { onCycleFinished: () => void }) {
  const [state, setState] = useState<Automode | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let wasRunning = false
    const load = async () => {
      try {
        const s = await api.automode()
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
  }, [onCycleFinished])

  const update = async (changes: Parameters<typeof api.setAutomode>[0]) => {
    try {
      setState(await api.setAutomode(changes))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const runNow = async () => {
    try {
      await api.runAutomode()
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
        <span className="hidden sm:inline">Automode {state.enabled ? 'an' : 'aus'}</span>
      </button>
      {open && (
        <div className="glass absolute right-0 top-12 z-50 w-[min(340px,calc(100vw-24px))] rounded-2xl p-4 text-xs text-ink-2">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-1">
            <Bot size={16} className="text-accent" /> Automode
          </div>
          <p className="mb-3 text-ink-3">
            Prüft alle hinterlegten Lieferantennummern, aktualisiert die Daten aus den Quellsystemen und benachrichtigt die
            Einkäufer bei Eskalationen automatisch.
          </p>
          <Toggle label="Automatisch ausführen" checked={state.enabled} onChange={(v) => update({ enabled: v })} />
          <label className="mt-2 flex items-center justify-between gap-3">
            Intervall
            <select
              value={state.interval_minutes}
              onChange={(e) => update({ interval_minutes: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface-0 px-2 py-1 text-ink-1"
            >
              {INTERVALS.map((i) => (
                <option key={i.minutes} value={i.minutes}>
                  {i.label}
                </option>
              ))}
              {!INTERVALS.some((i) => i.minutes === state.interval_minutes) && (
                <option value={state.interval_minutes}>alle {state.interval_minutes} min</option>
              )}
            </select>
          </label>

          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 font-medium text-ink-1">Benachrichtigen über</div>
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
                <span className={c.configured ? 'text-good' : 'text-ink-3'}>{c.configured ? 'verbunden' : 'nicht konfiguriert'}</span>
              </label>
            ))}
            <div className="py-1 text-ink-3">Cockpit-Benachrichtigung ist immer aktiv.</div>
          </div>

          <div className="mt-3 space-y-0.5 border-t border-line pt-3 text-ink-3">
            <div>Letzter Lauf: {when(state.last_run)}</div>
            {state.enabled && <div>Nächster Lauf: {when(state.next_run)}</div>}
            {state.last_result && (
              <div>
                {state.last_result.suppliers} Lieferanten · {state.last_result.escalations} Eskalationen · {state.last_result.sent} versendet
                {state.last_result.failed > 0 && <span className="text-[#ff8a8a]"> · {state.last_result.failed} fehlgeschlagen</span>}
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
            {state.running ? 'Lauf aktiv …' : 'Jetzt ausführen'}
          </button>
        </div>
      )}
    </div>
  )
}
