import { ChevronDown, Loader2, Plus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '../api'
import { STATUS } from '../theme'
import type { Light, Supplier, SupplierInput } from '../types'
import { StatusIcon } from './ui'

interface Props {
  commodities: string[]
  onCreated: (s: Supplier) => void
  onClose: () => void
}

const LAST_YEAR = new Date().getFullYear() - 1
const YEARS = [LAST_YEAR - 2, LAST_YEAR - 1, LAST_YEAR]

const input =
  'w-full rounded-lg border border-line bg-surface-0/70 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-accent/70 focus:outline-none'

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-ink-3">{hint}</span>}
    </label>
  )
}

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

export function SupplierForm({ commodities, onCreated, onClose }: Props) {
  const [master, setMaster] = useState({
    number: '',
    name: '',
    commodity: '',
    city: '',
    country: '',
    website: '',
    buyer_name: '',
    buyer_email: '',
    register_status: 'green' as Light,
  })
  const [years, setYears] = useState(YEARS.map((year) => ({ year, revenue: '', purchase: '' })))
  const [figures, setFigures] = useState({ plan_next_year: '', pd_current: '', pd_previous: '', ppm_current: '', ppm_previous: '', otd: '' })
  const [showFigures, setShowFigures] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof typeof master) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setMaster({ ...master, [k]: e.target.value })
  const setFig = (k: keyof typeof figures) => (e: React.ChangeEvent<HTMLInputElement>) => setFigures({ ...figures, [k]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const filledYears = years
      .filter((y) => y.revenue.trim() && y.purchase.trim())
      .map((y) => ({ year: y.year, revenue: num(y.revenue)!, purchase: num(y.purchase)! }))
    const fig = {
      years: filledYears,
      plan_next_year: num(figures.plan_next_year),
      pd_current: num(figures.pd_current),
      pd_previous: num(figures.pd_previous),
      ppm_current: num(figures.ppm_current),
      ppm_previous: num(figures.ppm_previous),
      otd: num(figures.otd),
    }
    const hasFigures = filledYears.length > 0 || Object.entries(fig).some(([k, v]) => k !== 'years' && v !== null)
    const body: SupplierInput = {
      ...master,
      commodity: master.commodity.trim() || 'Sonstige',
      buyer_email: master.buyer_email.trim() || null,
      figures: hasFigures ? fig : null,
    }
    setSaving(true)
    try {
      onCreated(await api.createSupplier(body))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm md:p-8">
      <form onSubmit={submit} className="glass my-auto w-full max-w-2xl rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-1">Lieferant anlegen</h2>
            <p className="text-xs text-ink-3">Nach dem Speichern bewerten die KI-Agenten den Lieferanten sofort.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1" aria-label="Schließen">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-5 px-5 py-4">
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Stammdaten</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Lieferantennummer *">
                <input required value={master.number} onChange={set('number')} className={input} placeholder="z. B. 70012345" />
              </Field>
              <Field label="Name *">
                <input required minLength={2} value={master.name} onChange={set('name')} className={input} placeholder="Firmenname" />
              </Field>
              <Field label="Warengruppe">
                <input list="commodities" value={master.commodity} onChange={set('commodity')} className={input} placeholder="z. B. Elektronik" />
                <datalist id="commodities">
                  {commodities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Website" hint="Startpunkt für das Web-Crawling">
                <input type="url" value={master.website} onChange={set('website')} className={input} placeholder="https://…" />
              </Field>
              <Field label="Ort">
                <input value={master.city} onChange={set('city')} className={input} />
              </Field>
              <Field label="Land (ISO)">
                <input value={master.country} onChange={set('country')} maxLength={3} className={input} placeholder="DE" />
              </Field>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Verantwortlicher Einkäufer</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input value={master.buyer_name} onChange={set('buyer_name')} className={input} />
              </Field>
              <Field label="E-Mail" hint="Empfänger der Frühwarnungen (Outlook/Teams im Automode)">
                <input type="email" value={master.buyer_email} onChange={set('buyer_email')} className={input} placeholder="name@firma.de" />
              </Field>
            </div>
            <div className="mt-3">
              <span className="mb-1 block text-[11px] font-medium text-ink-2">Status im internen Risikoregister</span>
              <div className="flex gap-2">
                {(['green', 'yellow', 'red'] as Light[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setMaster({ ...master, register_status: l })}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
                      master.register_status === l ? 'border-accent/70 bg-accent/15 text-ink-1' : 'border-line text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    <StatusIcon light={l} size={12} /> {STATUS[l].label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section>
            <button
              type="button"
              onClick={() => setShowFigures(!showFigures)}
              className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2.5 text-left text-sm text-ink-2 hover:border-ink-3/40"
              aria-expanded={showFigures}
            >
              <span>
                Kennzahlen erfassen <span className="text-xs text-ink-3">(optional – sonst bewertet das System nur mit den verfügbaren Daten)</span>
              </span>
              <ChevronDown size={16} className={showFigures ? 'rotate-180' : ''} />
            </button>
            {showFigures && (
              <div className="mt-3 space-y-4">
                <div>
                  <span className="mb-1 block text-[11px] font-medium text-ink-2">Spend Cube (Mio. €)</span>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <table className="w-full text-xs">
                      <thead className="bg-white/5 text-ink-3">
                        <tr>
                          <th className="p-2 text-left font-medium">Jahr</th>
                          <th className="p-2 text-left font-medium">Umsatz Lieferant</th>
                          <th className="p-2 text-left font-medium">Unser Einkaufsvolumen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {years.map((y, i) => (
                          <tr key={y.year} className="border-t border-line/60">
                            <td className="p-2 font-mono text-ink-2">{y.year}</td>
                            {(['revenue', 'purchase'] as const).map((k) => (
                              <td key={k} className="p-1.5">
                                <input
                                  inputMode="decimal"
                                  value={y[k]}
                                  onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                                  className={input}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={`Planvolumen ${LAST_YEAR + 1} (Mio. €)`}>
                    <input inputMode="decimal" value={figures.plan_next_year} onChange={setFig('plan_next_year')} className={input} />
                  </Field>
                  <Field label="Coface-PD aktuell (%)">
                    <input inputMode="decimal" value={figures.pd_current} onChange={setFig('pd_current')} className={input} />
                  </Field>
                  <Field label="Coface-PD vor 12 Monaten (%)">
                    <input inputMode="decimal" value={figures.pd_previous} onChange={setFig('pd_previous')} className={input} />
                  </Field>
                  <Field label="Reklamationen aktuell (ppm)">
                    <input inputMode="decimal" value={figures.ppm_current} onChange={setFig('ppm_current')} className={input} />
                  </Field>
                  <Field label="Reklamationen Vorjahr (ppm)">
                    <input inputMode="decimal" value={figures.ppm_previous} onChange={setFig('ppm_previous')} className={input} />
                  </Field>
                  <Field label="Liefertreue (%)">
                    <input inputMode="decimal" value={figures.otd} onChange={setFig('otd')} className={input} />
                  </Field>
                </div>
              </div>
            )}
          </section>

          {error && <div className="rounded-xl border border-crit/50 bg-crit/10 px-3 py-2 text-sm text-[#ff8a8a]">{error}</div>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-2 hover:bg-white/5">
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            {saving ? 'Wird bewertet …' : 'Anlegen & bewerten'}
          </button>
        </footer>
      </form>
    </div>
  )
}
