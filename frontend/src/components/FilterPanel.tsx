import { ChevronDown, Factory, Globe, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { RISK, RISK_ORDER, fmt, fmtUnit, joinDot } from '../theme'
import type { Filters, Plant, Supplier } from '../types'
import { Chip, StatusIcon, Toggle } from './ui'

interface Props {
  filters: Filters
  setFilters: (f: Filters) => void
  suppliers: Supplier[]
  visible: Supplier[]
  commodities: string[]
  countries: string[]
  plants: Plant[]
  /** List view: the table shows the suppliers, so the panel keeps only the filters. */
  compact?: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onAdd: () => void
  /** Artifact only: web research for several suppliers via a Claude chat. */
  onBatchResearch?: () => void
  /** Artifact only: shown while demo suppliers exist. */
  onRemoveDemoData?: () => void
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  statuses: [],
  commodities: [],
  countries: [],
  plants: [],
  escalatedOnly: false,
  highDependency: false,
  minPd: 0,
}

export function applyFilters(suppliers: Supplier[], f: Filters) {
  const q = f.query.trim().toLowerCase()
  return suppliers.filter(
    (s) =>
      (!q ||
        [s.name, s.number, s.street, s.zip, s.city, s.country, s.commodity, s.buyer.name].some((v) => (v ?? '').toLowerCase().includes(q))) &&
      (!f.statuses.length || (s.status && f.statuses.includes(s.status))) &&
      (!f.commodities.length || f.commodities.includes(s.commodity)) &&
      (!f.countries.length || f.countries.includes(s.country)) &&
      (!f.plants.length || f.plants.some((p) => s.plant_ids?.includes(p))) &&
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
  plants,
  compact,
  selectedId,
  onSelect,
  onHover,
  onAdd,
  onBatchResearch,
  onRemoveDemoData,
}: Props) {
  const { t } = useI18n()
  const [confirmDemo, setConfirmDemo] = useState(false)
  const active =
    filters.query ||
    filters.statuses.length ||
    filters.plants.length ||
    filters.commodities.length ||
    filters.countries.length ||
    filters.escalatedOnly ||
    filters.highDependency ||
    filters.minPd > 0
  // Escalated first, then risk, then no risk; within a group by number of risk indicators.
  const rank = (s: Supplier) => RISK_ORDER.indexOf(s.status ?? 'none')
  const sorted = [...visible].sort(
    (a, b) => rank(a) - rank(b) || (b.risk_indicators ?? 0) - (a.risk_indicators ?? 0) || a.name.localeCompare(b.name),
  )
  // On small screens the filters and the list collapse behind a toggle so the 3D scene stays visible.
  const [open, setOpen] = useState(false)
  const collapsible = open ? '' : 'hidden md:block'

  return (
    <aside className="glass scroll-thin pointer-events-auto flex max-h-full w-full flex-col overflow-y-auto rounded-2xl md:w-[330px]">
      <div className="border-b border-line p-3 md:p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder={t('filter.search')}
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
            aria-label={t('filter.add')}
            title={t('filter.add')}
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
              <SlidersHorizontal size={12} /> {t('filter.title')}
            </span>
            {active ? (
              <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-[11px] text-accent hover:underline">
                {t('filter.reset')}
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {RISK_ORDER.map((st) => (
              <Chip
                key={st}
                active={filters.statuses.includes(st)}
                onClick={() => setFilters({ ...filters, statuses: toggle(filters.statuses, st) })}
              >
                <StatusIcon light={RISK[st].light} size={12} /> {t(`risk.${st}`)}
                <span className="text-ink-3">{suppliers.filter((s) => s.status === st).length}</span>
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
          {plants.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plants.map((p) => (
                <Chip
                  key={p.id}
                  active={filters.plants.includes(p.id)}
                  onClick={() => setFilters({ ...filters, plants: toggle(filters.plants, p.id) })}
                >
                  <Factory size={11} /> {p.name}
                </Chip>
              ))}
            </div>
          )}
          <div className="mt-3 border-t border-line pt-2">
            <Toggle
              label={t('filter.escalated_only')}
              checked={filters.escalatedOnly}
              onChange={(v) => setFilters({ ...filters, escalatedOnly: v })}
            />
            <Toggle
              label={t('filter.high_dependency')}
              checked={filters.highDependency}
              onChange={(v) => setFilters({ ...filters, highDependency: v })}
            />
            <div className="mt-1 text-xs text-ink-2">
              <div className="flex justify-between">
                <span>{t('filter.min_pd')}</span>
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
        <span>{t('filter.count', { visible: visible.length, total: suppliers.length })}</span>
        {!compact && <span>{t('filter.escalated_first')}</span>}
      </div>
      <ul className={`${compact ? 'hidden' : collapsible} scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:min-h-[220px]`}>
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
                <StatusIcon light={RISK[s.status ?? 'none'].light} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink-1">{s.name}</span>
                <span className="block truncate text-[11px] text-ink-3">
                  {joinDot(s.number, s.city, `CS ${fmtUnit(s.customer_share, '%', 0)}`, `PD ${fmtUnit(s.pd, '%', 1)}`)}
                </span>
              </span>
              {(s.risk_indicators ?? 0) > 0 && (
                <span className="shrink-0 text-[11px] text-ink-3" title={t('filter.risk_indicators')}>
                  {s.risk_indicators} RI
                </span>
              )}
            </button>
          </li>
        ))}
        {!sorted.length && (
          <li className="px-3 py-6 text-center text-xs text-ink-3">
            {suppliers.length ? (
              t('filter.empty')
            ) : (
              <>
                {t('filter.no_suppliers')}
                <button onClick={onAdd} className="mt-2 block w-full text-accent hover:underline">
                  {t('filter.first')}
                </button>
              </>
            )}
          </li>
        )}
      </ul>
      {(onBatchResearch || onRemoveDemoData) && (
        <div className={`${open ? 'flex' : 'hidden md:flex'} flex-wrap items-center gap-2 border-t border-line px-3 py-2.5`}>
          {onBatchResearch && (
            <button
              onClick={onBatchResearch}
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:border-accent/60 hover:text-ink-1"
              title={t('filter.batch_title')}
            >
              <Globe size={13} className="text-accent" /> {t('filter.batch')}
            </button>
          )}
          {onRemoveDemoData &&
            (confirmDemo ? (
              <span className="ml-auto flex items-center gap-1 text-xs">
                <button
                  onClick={() => {
                    setConfirmDemo(false)
                    onRemoveDemoData()
                  }}
                  className="rounded-lg bg-crit/20 px-2 py-1 font-medium text-[#ff8a8a] hover:bg-crit/30"
                >
                  {t('filter.remove_demo_confirm')}
                </button>
                <button onClick={() => setConfirmDemo(false)} className="px-1.5 py-1 text-ink-3 hover:text-ink-1">
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDemo(true)}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-3 hover:text-[#ff8a8a]"
              >
                <Trash2 size={13} /> {t('filter.remove_demo')}
              </button>
            ))}
        </div>
      )}
    </aside>
  )
}
