import { ChevronDown, Factory, Loader2, Plus, Save, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { backend } from '../backend'
import { useI18n } from '../i18n'
import type { Light, Plant, Supplier, SupplierInput } from '../types'
import { Chip, StatusIcon } from './ui'

interface Props {
  commodities: string[]
  plants: Plant[]
  /** Edit mode: the supplier to change. */
  supplier?: Supplier
  onSaved: (s: Supplier) => void
  onClose: () => void
}

const LAST_YEAR = new Date().getFullYear() - 1
const YEARS = [LAST_YEAR - 2, LAST_YEAR - 1, LAST_YEAR]

export const inputClass =
  'w-full rounded-lg border border-line bg-surface-0/70 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-accent/70 focus:outline-none'

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-[11px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-ink-3">{hint}</span>}
    </label>
  )
}

export const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

export interface AddressState {
  street: string
  zip: string
  city: string
  country: string
  lat: string
  lon: string
}

/** Street, postcode, city, country and optional manual coordinates (supplier and plant forms). */
export function AddressFields({ value, onChange, manual }: { value: AddressState; onChange: (v: AddressState) => void; manual: boolean }) {
  const { t } = useI18n()
  const [showCoords, setShowCoords] = useState(manual)
  const set = (k: keyof AddressState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  return (
    <>
      <div className="grid grid-cols-6 gap-3">
        <Field label={t('form.street')} className="col-span-6 sm:col-span-4">
          <input value={value.street} onChange={set('street')} className={inputClass} autoComplete="street-address" />
        </Field>
        <Field label={t('form.zip')} className="col-span-2">
          <input value={value.zip} onChange={set('zip')} className={inputClass} autoComplete="postal-code" />
        </Field>
        <Field label={t('form.city')} className="col-span-4 sm:col-span-4">
          <input value={value.city} onChange={set('city')} className={inputClass} autoComplete="address-level2" />
        </Field>
        <Field label={t('form.country')} className="col-span-2">
          <input value={value.country} onChange={set('country')} maxLength={2} className={inputClass} placeholder="DE" />
        </Field>
      </div>
      <button type="button" onClick={() => setShowCoords(!showCoords)} className="mt-2 text-[11px] text-accent hover:underline">
        {t('form.coords')}
      </button>
      {showCoords && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label={t('form.lat')}>
            <input inputMode="decimal" value={value.lat} onChange={set('lat')} className={inputClass} placeholder="48.89" />
          </Field>
          <Field label={t('form.lon')}>
            <input inputMode="decimal" value={value.lon} onChange={set('lon')} className={inputClass} placeholder="8.70" />
          </Field>
        </div>
      )}
    </>
  )
}

export const addressFrom = (e?: { street?: string; zip?: string; city: string; country: string; location?: Supplier['location'] }) => ({
  street: e?.street ?? '',
  zip: e?.zip ?? '',
  city: e?.city ?? '',
  country: e?.country ?? '',
  lat: e?.location?.precision === 'manual' ? str(e.location.lat) : '',
  lon: e?.location?.precision === 'manual' ? str(e.location.lon) : '',
})

export const addressInput = (a: AddressState) => ({
  street: a.street.trim(),
  zip: a.zip.trim(),
  city: a.city.trim(),
  country: a.country.trim().toUpperCase(),
  lat: num(a.lat),
  lon: num(a.lon),
})

export function SupplierForm({ commodities, plants, supplier, onSaved, onClose }: Props) {
  const { t } = useI18n()
  const editing = !!supplier
  const [master, setMaster] = useState({
    number: supplier?.number ?? '',
    name: supplier?.name ?? '',
    commodity: supplier?.commodity ?? '',
    website: supplier?.website ?? '',
    buyer_name: supplier?.buyer.name ?? '',
    buyer_email: supplier?.buyer.email ?? '',
    register_status: (supplier?.register_status ?? 'green') as Light,
  })
  const [address, setAddress] = useState<AddressState>(() => addressFrom(supplier))
  const [plantIds, setPlantIds] = useState<string[]>(supplier?.plant_ids ?? [])
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
      ...addressInput(address),
      commodity: master.commodity.trim() || 'Sonstige',
      buyer_email: master.buyer_email.trim() || null,
      plant_ids: plantIds,
      figures: hasFigures ? fig : null,
    }
    setSaving(true)
    try {
      onSaved(editing ? await backend.updateSupplier(supplier.id, body) : await backend.createSupplier(body))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const h3 = 'mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3'

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm md:p-8">
      <form onSubmit={submit} className="glass my-auto w-full max-w-2xl rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-1">{editing ? t('form.title.edit') : t('form.title.create')}</h2>
            <p className="text-xs text-ink-3">{t('form.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1"
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </header>

        <div className="space-y-5 px-5 py-4">
          <section>
            <h3 className={h3}>{t('form.master')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('form.number')}>
                <input required value={master.number} onChange={set('number')} className={inputClass} placeholder={t('form.number.ph')} />
              </Field>
              <Field label={t('form.name')}>
                <input required minLength={2} value={master.name} onChange={set('name')} className={inputClass} placeholder={t('form.name.ph')} />
              </Field>
              <Field label={t('form.commodity')}>
                <input
                  list="commodities"
                  value={master.commodity}
                  onChange={set('commodity')}
                  className={inputClass}
                  placeholder={t('form.commodity.ph')}
                />
                <datalist id="commodities">
                  {commodities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label={t('form.website')} hint={t('form.website.hint')}>
                <input type="url" value={master.website} onChange={set('website')} className={inputClass} placeholder="https://…" />
              </Field>
            </div>
          </section>

          <section>
            <h3 className={h3}>{t('form.address')}</h3>
            <p className="-mt-1 mb-2 text-[11px] text-ink-3">{t('form.address.hint')}</p>
            <AddressFields value={address} onChange={setAddress} manual={supplier?.location?.precision === 'manual'} />
          </section>

          <section>
            <h3 className={h3}>{t('form.plants')}</h3>
            <p className="-mt-1 mb-2 text-[11px] text-ink-3">{t('form.plants.hint')}</p>
            {plants.length ? (
              <div className="flex flex-wrap gap-1.5">
                {plants.map((p) => (
                  <Chip
                    key={p.id}
                    active={plantIds.includes(p.id)}
                    onClick={() => setPlantIds(plantIds.includes(p.id) ? plantIds.filter((x) => x !== p.id) : [...plantIds, p.id])}
                  >
                    <Factory size={11} /> {p.name}
                    {p.city && <span className="text-ink-3">{p.city}</span>}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-3">{t('form.no_plants')}</p>
            )}
          </section>

          <section>
            <h3 className={h3}>{t('form.buyer')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('form.buyer_name')}>
                <input value={master.buyer_name} onChange={set('buyer_name')} className={inputClass} />
              </Field>
              <Field label={t('form.buyer_email')} hint={t('form.buyer_email.hint')}>
                <input
                  type="email"
                  value={master.buyer_email}
                  onChange={set('buyer_email')}
                  className={inputClass}
                  placeholder={t('form.buyer_email.ph')}
                />
              </Field>
            </div>
            <div className="mt-3">
              <span className="mb-1 block text-[11px] font-medium text-ink-2">{t('form.register')}</span>
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
                    <StatusIcon light={l} size={12} /> {t(`light.${l}`)}
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
                {t('form.figures')}{' '}
                <span className="text-xs text-ink-3">{editing ? t('form.figures.hint_edit') : t('form.figures.hint')}</span>
              </span>
              <ChevronDown size={16} className={showFigures ? 'rotate-180' : ''} />
            </button>
            {showFigures && (
              <div className="mt-3 space-y-4">
                <div>
                  <span className="mb-1 block text-[11px] font-medium text-ink-2">{t('form.spend')}</span>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <table className="w-full text-xs">
                      <thead className="bg-white/5 text-ink-3">
                        <tr>
                          <th className="p-2 text-left font-medium">{t('form.year')}</th>
                          <th className="p-2 text-left font-medium">{t('form.revenue')}</th>
                          <th className="p-2 text-left font-medium">{t('form.purchase')}</th>
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
                                  className={inputClass}
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
                  <Field label={t('form.plan', { year: LAST_YEAR + 1 })}>
                    <input inputMode="decimal" value={figures.plan_next_year} onChange={setFig('plan_next_year')} className={inputClass} />
                  </Field>
                  <Field label={t('form.pd_current')}>
                    <input inputMode="decimal" value={figures.pd_current} onChange={setFig('pd_current')} className={inputClass} />
                  </Field>
                  <Field label={t('form.pd_previous')}>
                    <input inputMode="decimal" value={figures.pd_previous} onChange={setFig('pd_previous')} className={inputClass} />
                  </Field>
                  <Field label={t('form.ppm_current')}>
                    <input inputMode="decimal" value={figures.ppm_current} onChange={setFig('ppm_current')} className={inputClass} />
                  </Field>
                  <Field label={t('form.ppm_previous')}>
                    <input inputMode="decimal" value={figures.ppm_previous} onChange={setFig('ppm_previous')} className={inputClass} />
                  </Field>
                  <Field label={t('form.otd')}>
                    <input inputMode="decimal" value={figures.otd} onChange={setFig('otd')} className={inputClass} />
                  </Field>
                </div>
              </div>
            )}
          </section>

          {error && <div className="rounded-xl border border-crit/50 bg-crit/10 px-3 py-2 text-sm text-[#ff8a8a]">{error}</div>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-2 hover:bg-white/5">
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="spin" /> : editing ? <Save size={16} /> : <Plus size={16} />}
            {saving ? t('form.saving') : editing ? t('form.submit.edit') : t('form.submit.create')}
          </button>
        </footer>
      </form>
    </div>
  )
}
