/** Table of the (filtered) suppliers for quick comparison; every column sorts. */
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { RISK, RISK_ORDER, fmt, fmtDate } from '../theme'
import type { Plant, Supplier } from '../types'
import { StatusIcon } from './ui'

type Col = 'status' | 'name' | 'number' | 'commodity' | 'location' | 'plants' | 'share' | 'pd' | 'forecast' | 'volume' | 'ri' | 'web' | 'assessed'

interface Props {
  suppliers: Supplier[]
  plants: Plant[]
  selectedId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

const NUMERIC: Col[] = ['share', 'pd', 'forecast', 'volume', 'ri', 'web']

export function ListView({ suppliers, plants, selectedId, onSelect, onHover }: Props) {
  const { t, locale } = useI18n()
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'status', dir: 1 })
  const plantNames = useMemo(() => Object.fromEntries(plants.map((p) => [p.id, p.name])), [plants])
  const plantsOf = (s: Supplier) => (s.plant_ids ?? []).map((id) => plantNames[id]).filter(Boolean)

  const value = (s: Supplier, col: Col): string | number | null => {
    switch (col) {
      case 'status':
        return RISK_ORDER.indexOf(s.status ?? 'none')
      case 'name':
        return s.name
      case 'number':
        return s.number
      case 'commodity':
        return s.commodity
      case 'location':
        return [s.country, s.city].join(' ')
      case 'plants':
        return plantsOf(s).join(', ')
      case 'share':
        return s.customer_share ?? null
      case 'pd':
        return s.pd ?? null
      case 'forecast':
        return s.revenue_forecast ?? null
      case 'volume':
        return s.purchase_volume ?? null
      case 'ri':
        return s.risk_indicators ?? 0
      case 'web':
        return s.external_risks ?? 0
      case 'assessed':
        return s.assessed_at ?? ''
    }
  }

  const rows = useMemo(() => {
    const cmp = (a: Supplier, b: Supplier) => {
      const va = value(a, sort.col)
      const vb = value(b, sort.col)
      // Missing values always last, whatever the direction.
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), locale)
      return r * sort.dir
    }
    return [...suppliers].sort(
      (a, b) => cmp(a, b) || (b.risk_indicators ?? 0) - (a.risk_indicators ?? 0) || a.name.localeCompare(b.name, locale),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers, sort, locale, plantNames])

  const header = (col: Col, label: string, right = false) => {
    const active = sort.col === col
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
    return (
      <th className={`sticky top-0 z-10 bg-surface-1 px-2 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>
        <button
          onClick={() =>
            setSort(active ? { col, dir: sort.dir === 1 ? -1 : 1 } : { col, dir: NUMERIC.includes(col) || col === 'assessed' ? -1 : 1 })
          }
          className={`inline-flex items-center gap-1 whitespace-nowrap ${active ? 'text-ink-1' : 'text-ink-3 hover:text-ink-2'}`}
          aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
        >
          {label} <Icon size={11} className={active ? 'text-accent' : 'opacity-50'} />
        </button>
      </th>
    )
  }

  const exportCsv = () => {
    const cols: [string, (s: Supplier) => unknown][] = [
      [t('list.status'), (s) => t(`risk.${s.status ?? 'none'}`)],
      [t('list.name'), (s) => s.name],
      [t('list.number'), (s) => s.number],
      [t('list.commodity'), (s) => s.commodity],
      [t('form.street'), (s) => s.street],
      [t('form.zip'), (s) => s.zip],
      [t('form.city'), (s) => s.city],
      [t('form.country'), (s) => s.country],
      [t('list.plants'), (s) => plantsOf(s).join(', ')],
      [`${t('list.share')} %`, (s) => s.customer_share],
      [`${t('list.pd')} %`, (s) => s.pd],
      [`${t('list.forecast')} %`, (s) => s.revenue_forecast],
      [`${t('list.volume')} ${t('unit.eur_m')}`, (s) => s.purchase_volume],
      [t('list.ri'), (s) => s.risk_indicators],
      [t('list.web'), (s) => s.external_risks],
      [t('list.assessed'), (s) => s.assessed_at],
      [t('detail.recommendation'), (s) => s.recommendation],
    ]
    const cell = (v: unknown) => {
      const text = v === null || v === undefined ? '' : String(v)
      return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const csv = [cols.map(([h]) => cell(h)).join(';'), ...rows.map((s) => cols.map(([, f]) => cell(f(s))).join(';'))].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'suppliers.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '–' : `${fmt(v, d)} %`)

  return (
    <section className="glass pointer-events-auto flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-ink-1">{t('list.title')}</h2>
          <p className="text-[11px] text-ink-3">{t('list.hint')}</p>
        </div>
        <button
          onClick={exportCsv}
          title={t('list.export_title')}
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:border-accent/60 hover:text-ink-1"
        >
          <Download size={13} /> {t('list.export')}
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-line">
              {header('status', t('list.status'))}
              {header('name', t('list.name'))}
              {header('number', t('list.number'))}
              {header('commodity', t('list.commodity'))}
              {header('location', t('list.location'))}
              {header('plants', t('list.plants'))}
              {header('share', t('list.share'), true)}
              {header('pd', t('list.pd'), true)}
              {header('forecast', t('list.forecast'), true)}
              {header('volume', t('list.volume'), true)}
              {header('ri', t('list.ri'), true)}
              {header('web', t('list.web'), true)}
              {header('assessed', t('list.assessed'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const st = s.status ?? 'none'
              return (
                <tr
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  onMouseEnter={() => onHover(s.id)}
                  onMouseLeave={() => onHover(null)}
                  className={`cursor-pointer border-b border-line/50 transition ${s.id === selectedId ? 'bg-accent/15' : 'hover:bg-white/5'}`}
                >
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                      <StatusIcon light={RISK[st].light} size={14} /> {t(`risk.${st}`)}
                    </span>
                  </td>
                  <td className="max-w-[240px] truncate px-2 py-2 font-medium text-ink-1" title={s.name}>
                    {s.name}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-ink-3">{s.number}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-ink-2">{s.commodity}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-ink-2">{[s.city, s.country].filter(Boolean).join(', ') || '–'}</td>
                  <td className="max-w-[200px] truncate px-2 py-2 text-ink-3" title={plantsOf(s).join(', ')}>
                    {plantsOf(s).join(', ') || '–'}
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right font-mono ${(s.customer_share ?? 0) >= 50 ? 'text-[#ff8a5c]' : 'text-ink-2'}`}>
                    {pct(s.customer_share)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-ink-2">{pct(s.pd, 2)}</td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right font-mono ${(s.revenue_forecast ?? 0) < 0 ? 'text-[#ff8a8a]' : 'text-ink-2'}`}>
                    {s.revenue_forecast === null || s.revenue_forecast === undefined
                      ? '–'
                      : `${s.revenue_forecast > 0 ? '+' : ''}${fmt(s.revenue_forecast, 1)} %`}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-ink-2">{fmt(s.purchase_volume, 1)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-ink-2">{s.risk_indicators ?? 0}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-ink-2">{s.external_risks ?? 0}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-ink-3">{fmtDate(s.assessed_at, false)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <p className="px-4 py-8 text-center text-xs text-ink-3">{t('filter.empty')}</p>}
      </div>
    </section>
  )
}
