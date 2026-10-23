import { ChevronDown, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { STATUS, fmt } from '../theme'
import type { Filters, Light, Supplier } from '../types'
import { Chip, StatusIcon, Toggle } from './ui'

interface Props {
  filters: Filters
  setFilters: (f: Filters) => void
  suppliers: Supplier[]
  visible: Supplier[]
  commodities: string[]
  countries: string[]
  selectedId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onAdd: () => void
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  lights: [],
  commodities: [],
  countries: [],
  escalatedOnly: false,
  highDependency: false,
  minPd: 0,
}

export function applyFilters(suppliers: Supplier[], f: Filters) {
  const q = f.query.trim().toLowerCase()
  return suppliers.filter(
    (s) =>
      (!q || [s.name, s.number, s.city, s.country, s.commodity, s.buyer.name].some((v) => v.toLowerCase().includes(q))) &&
      (!f.lights.length || (s.traffic_light && f.lights.includes(s.traffic_light))) &&
      (!f.commodities.length || f.commodities.includes(s.commodity)) &&
      (!f.countries.length || f.countries.includes(s.country)) &&
      (!f.escalatedOnly || s.escalate) &&
      (!f.highDependency || (s.customer_share ?? 0) >= 50) &&
      (s.pd ?? 0) >= f.minPd,
  )
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function FilterPanel({
  filters,
  setFilters,
  suppliers,
  visible,
  commodities,
  countries,
  selectedId,
  onSelect,
  onHover,
  onAdd,
}: Props) {
  const active =
    filters.query ||
    filters.lights.length ||
    filters.commodities.length ||
    filters.countries.length ||
    filters.escalatedOnly ||
    filters.highDependency ||
    filters.minPd > 0
  const sorted = [...visible].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  // On small screens the filters and the list collapse behind a toggle so the 3D scene stays visible.
  const [open, setOpen] = useState(false)
  const collapsible = open ? '' : 'hidden md:block'

  return (
    <aside className="glass scroll-thin pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-2xl md:w-[330px]">
      <div className="border-b border-line p-3 md:p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder="Name oder Lieferantennr. …"
              className="w-full rounded-xl border border-line bg-surface-0/70 py-2 pl-9 pr-8 text-sm text-ink-1 placeholder:text-ink-3 focus:border-accent/70 focus:outline-none"
            />
            {filters.query && (
              <button
                onClick={() => setFilters({ ...filters, query: '' })}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-1"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            onClick={onAdd}
            className="flex items-center justify-center rounded-xl bg-accent px-2.5 text-white hover:brightness-110"
            aria-label="Lieferant anlegen"
            title="Lieferant anlegen"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 rounded-xl border border-line px-2.5 text-xs text-ink-2 md:hidden"
            aria-expanded={open}
          >
            {visible.length}/{suppliers.length} <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
          </button>
        </div>

        <div className={collapsible}>
          <div className="mt-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              <SlidersHorizontal size={12} /> Filter
            </span>
            {active ? (
              <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-[11px] text-accent hover:underline">
                Zurücksetzen
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['red', 'yellow', 'green'] as Light[]).map((l) => (
              <Chip
                key={l}
                active={filters.lights.includes(l)}
                onClick={() => setFilters({ ...filters, lights: toggle(filters.lights, l) })}
              >
                <StatusIcon light={l} size={12} /> {STATUS[l].label}
                <span className="text-ink-3">{suppliers.filter((s) => s.traffic_light === l).length}</span>
              </Chip>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {commodities.map((c) => (
              <Chip
                key={c}
                active={filters.commodities.includes(c)}
                onClick={() => setFilters({ ...filters, commodities: toggle(filters.commodities, c) })}
              >
                {c}
              </Chip>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {countries.map((c) => (
              <Chip
                key={c}
                active={filters.countries.includes(c)}
                onClick={() => setFilters({ ...filters, countries: toggle(filters.countries, c) })}
              >
                {c}
              </Chip>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-2">
            <Toggle
              label="Nur eskalierte Lieferanten"
              checked={filters.escalatedOnly}
              onChange={(v) => setFilters({ ...filters, escalatedOnly: v })}
            />
            <Toggle
              label="Customer-Share ≥ 50 %"
              checked={filters.highDependency}
              onChange={(v) => setFilters({ ...filters, highDependency: v })}
            />
            <div className="mt-1 text-xs text-ink-2">
              <div className="flex justify-between">
                <span>Mindest-PD (Coface)</span>
                <span className="font-mono text-ink-1">≥ {fmt(filters.minPd, 1)} %</span>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                step={0.1}
                value={filters.minPd}
                onChange={(e) => setFilters({ ...filters, minPd: Number(e.target.value) })}
                className="mt-1 w-full"
              />
            </div>
          </div>
        </div>
      </div>

      <div className={`${open ? 'flex' : 'hidden md:flex'} items-center justify-between px-4 pb-1 pt-3 text-[11px] text-ink-3`}>
        <span>
          {visible.length} von {suppliers.length} Lieferanten
        </span>
        <span>nach Score sortiert</span>
      </div>
      <ul className={`${collapsible} scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2`}>
        {sorted.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => {
                onSelect(s.id)
                setOpen(false)
              }}
              onMouseEnter={() => onHover(s.id)}
              onMouseLeave={() => onHover(null)}
              className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                s.id === selectedId ? 'bg-accent/15' : 'hover:bg-white/5'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${s.escalate ? 'pulse-crit' : ''}`}
              >
                <StatusIcon light={s.traffic_light ?? 'green'} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink-1">{s.name}</span>
                <span className="block truncate text-[11px] text-ink-3">
                  {s.number} · {s.city} · CS {fmt(s.customer_share, 0)} % · PD {fmt(s.pd, 1)} %
                </span>
              </span>
              <span className="font-mono text-sm text-ink-2">{s.score}</span>
            </button>
          </li>
        ))}
        {!sorted.length && (
          <li className="px-3 py-6 text-center text-xs text-ink-3">
            {suppliers.length ? (
              'Keine Lieferanten für diese Filter.'
            ) : (
              <>
                Noch keine Lieferanten erfasst.
                <button onClick={onAdd} className="mt-2 block w-full text-accent hover:underline">
                  Ersten Lieferanten anlegen
                </button>
              </>
            )}
          </li>
        )}
      </ul>
    </aside>
  )
}
