/**
 * Internal Module (Figure 3) – TypeScript port of backend/app/modules/internal_module.py
 * for the artifact variant, which runs the agents in the browser. Keep both in sync.
 */
import type { Kpi } from '../types'

export interface InternalData {
  as_of?: string
  revenue?: Record<string, number>
  purchase?: Record<string, number>
  plan_snapshots?: { date: string; volumes: Record<string, number> }[]
  pd_history?: { date: string; pd: number }[]
  quality?: Record<string, { ppm?: number | null; otd?: number | null }>
}

export interface InternalResult {
  as_of: string
  kpis: Kpi[]
  forecast: { year: number; revenue: number; purchase: number; customer_share: number }[]
  missing_sources: string[]
  series: {
    years: number[]
    revenue: number[]
    purchase: number[]
    customer_share: number[]
    pd_history: { date: string; pd: number }[]
    plan_revisions: { date: string; volume: number }[]
  }
}

type Threshold = { warn: number; critical: number }
export const THRESHOLDS: Record<string, Threshold> = {
  customer_share: { warn: 0.3, critical: 0.5 },
  customer_share_delta_pp: { warn: 5.0, critical: 10.0 },
  revenue_forecast_change: { warn: -0.05, critical: -0.1 },
  plan_change_next: { warn: -0.08, critical: -0.15 },
  plan_volatility: { warn: 0.08, critical: 0.15 },
  pd_latest: { warn: 1.0, critical: 3.0 },
  pd_change_pp: { warn: 0.5, critical: 1.0 },
  rating_staleness_months: { warn: 12, critical: 24 },
  ppm_change: { warn: 0.25, critical: 0.6 },
  otd_latest: { warn: 0.95, critical: 0.9 },
}

const FORECAST_HORIZON = 4
const OTHER_BUSINESS_GROWTH_CAP = 0.05
const SOURCES = ['Spend Cube', 'Demand Planning', 'Risk Management (Coface)', 'Quality Management']

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const pstdev = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const de = (v: number, d = 2) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })

function highIsBad(value: number, key: string): Kpi['status'] {
  const t = THRESHOLDS[key]
  return value >= t.critical ? 'critical' : value >= t.warn ? 'warn' : 'ok'
}

function lowIsBad(value: number, key: string): Kpi['status'] {
  const t = THRESHOLDS[key]
  return value <= t.critical ? 'critical' : value <= t.warn ? 'warn' : 'ok'
}

function monthsBetween(a: string, b: string) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)))
}

function cagr(first: number, last: number, years: number) {
  if (first <= 0 || years <= 0) return 0
  return (last / first) ** (1 / years) - 1
}

function spendYears(d: InternalData): number[] {
  const revenue = d.revenue ?? {}
  const purchase = d.purchase ?? {}
  return Object.keys(revenue)
    .filter((y) => y in purchase && revenue[y])
    .map(Number)
    .sort((a, b) => a - b)
}

export function revenueForecast(d: InternalData): InternalResult['forecast'] {
  const years = spendYears(d)
  const snapshots = d.plan_snapshots ?? []
  if (!years.length || !snapshots.length) return []
  const [first, last] = [years[0], years[years.length - 1]]
  const otherFirst = d.revenue![first] - d.purchase![first]
  const otherLast = d.revenue![last] - d.purchase![last]
  const g = Math.max(-OTHER_BUSINESS_GROWTH_CAP, Math.min(OTHER_BUSINESS_GROWTH_CAP, cagr(otherFirst, otherLast, last - first)))
  const plan = snapshots[snapshots.length - 1].volumes
  const out: InternalResult['forecast'] = []
  for (let k = 1; k <= FORECAST_HORIZON; k++) {
    const y = last + k
    if (!(String(y) in plan)) break
    const other = Math.max(0, otherLast * (1 + g) ** k)
    const p = plan[y]
    out.push({ year: y, revenue: round(p + other, 2), purchase: round(p, 2), customer_share: p + other ? round(p / (p + other), 4) : 0 })
  }
  return out
}

function spendKpis(d: InternalData, years: number[]): Kpi[] {
  const rev = d.revenue!
  const pur = d.purchase!
  const [first, last] = [years[0], years[years.length - 1]]
  const share = pur[last] / rev[last]
  const kpis: Kpi[] = [
    {
      id: 'customer_share',
      label: 'Customer-Share',
      group: 'Abhängigkeit',
      value: round(share * 100, 1),
      unit: '%',
      status: highIsBad(share, 'customer_share'),
      formula: `Einkaufsvolumen ${last} / Lieferantenumsatz ${last} = ${de(pur[last])} / ${de(rev[last])} Mio. €`,
      threshold: 'Warnung ≥ 30 %, kritisch ≥ 50 %',
      source: 'Spend Cube',
    },
  ]
  if (years.length < 2) return kpis
  const ref = Math.max(first, last - 3)
  const deltaPp = (share - pur[ref] / rev[ref]) * 100
  kpis.push({
    id: 'customer_share_delta',
    label: `Veränderung Customer-Share seit ${ref}`,
    group: 'Abhängigkeit',
    value: round(deltaPp, 1),
    unit: 'pp',
    status: highIsBad(deltaPp, 'customer_share_delta_pp'),
    formula: `Customer-Share ${last} − Customer-Share ${ref}`,
    threshold: 'Warnung ≥ +5 pp, kritisch ≥ +10 pp',
    source: 'Spend Cube',
  })
  const c = cagr(rev[first], rev[last], last - first)
  kpis.push({
    id: 'revenue_cagr',
    label: `Umsatz-CAGR ${first}–${last}`,
    group: 'Umsatz',
    value: round(c * 100, 1),
    unit: '%',
    status: c >= 0 ? 'ok' : c > -0.05 ? 'warn' : 'critical',
    formula: `(${de(rev[last])} / ${de(rev[first])})^(1/${last - first}) − 1`,
    threshold: 'Warnung < 0 %, kritisch ≤ −5 % p.a.',
    source: 'Spend Cube',
  })
  return kpis
}

function planKpis(d: InternalData, years: number[], forecast: InternalResult['forecast']): Kpi[] {
  const snapshots = d.plan_snapshots ?? []
  if (!snapshots.length || !years.length) return []
  const last = years[years.length - 1]
  const revLast = d.revenue![last]
  const purLast = d.purchase![last]
  const kpis: Kpi[] = []
  if (forecast.length) {
    const change = forecast[0].revenue / revLast - 1
    kpis.push({
      id: 'revenue_forecast',
      label: `Umsatzprognose ${forecast[0].year}`,
      group: 'Umsatz',
      value: round(change * 100, 2),
      unit: '%',
      status: lowIsBad(change, 'revenue_forecast_change'),
      formula: `Planvolumen ${forecast[0].year} + fortgeschriebenes Fremdgeschäft = ${de(forecast[0].revenue)} Mio. € vs. ${de(revLast)} Mio. €`,
      threshold: 'Warnung ≤ −5 %, kritisch ≤ −10 %',
      source: 'Spend Cube + Demand Planning',
    })
  }
  const nextYear = String(last + 1)
  const planNext = snapshots[snapshots.length - 1].volumes[nextYear]
  if (planNext !== undefined && purLast) {
    const change = planNext / purLast - 1
    kpis.push({
      id: 'plan_change',
      label: `Geplantes Einkaufsvolumen ${nextYear}`,
      group: 'Planung',
      value: round(change * 100, 1),
      unit: '%',
      status: lowIsBad(change, 'plan_change_next'),
      formula: `Plan ${nextYear} / Ist ${last} − 1 = ${de(planNext)} / ${de(purLast)}`,
      threshold: 'Warnung ≤ −8 %, kritisch ≤ −15 %',
      source: 'Demand Planning',
    })
  }
  const revisions = snapshots.filter((s) => nextYear in s.volumes).map((s) => s.volumes[nextYear])
  if (revisions.length >= 3 && mean(revisions) > 0) {
    const vol = pstdev(revisions) / mean(revisions)
    kpis.push({
      id: 'plan_volatility',
      label: `Volatilität Planvolumen ${nextYear}`,
      group: 'Planung',
      value: round(vol * 100, 1),
      unit: '%',
      status: highIsBad(vol, 'plan_volatility'),
      formula: `Variationskoeffizient über ${revisions.length} Planstände`,
      threshold: 'Warnung ≥ 8 %, kritisch ≥ 15 %',
      source: 'Demand Planning',
    })
  }
  return kpis
}

function ratingKpis(pdHist: { date: string; pd: number }[], asOf: string): Kpi[] {
  if (!pdHist.length) return []
  const latest = pdHist[pdHist.length - 1]
  const kpis: Kpi[] = [
    {
      id: 'pd_latest',
      label: 'Coface-Ausfallwahrscheinlichkeit (PD)',
      group: 'Rating',
      value: latest.pd,
      unit: '%',
      status: highIsBad(latest.pd, 'pd_latest'),
      formula: `Letzter Ratingstand vom ${latest.date}`,
      threshold: 'Gelb ≥ 1 %, rot ≥ 3 %',
      source: 'Risk Management (Coface)',
    },
  ]
  if (pdHist.length < 2) return kpis
  const window = pdHist.filter((p) => monthsBetween(p.date, asOf) <= 48)
  const base = window.length > 1 ? window[0] : pdHist[0]
  const change = latest.pd - base.pd
  kpis.push({
    id: 'pd_trend',
    label: `PD-Trend seit ${base.date.slice(0, 7)}`,
    group: 'Rating',
    value: round(change, 2),
    unit: 'pp',
    status: highIsBad(change, 'pd_change_pp'),
    formula: `${latest.pd} % − ${base.pd} %`,
    threshold: 'Warnung ≥ +0,5 pp, kritisch ≥ +1 pp',
    source: 'Risk Management (Coface)',
  })
  const gap = Math.max(...pdHist.slice(1).map((p, i) => monthsBetween(pdHist[i].date, p.date)))
  kpis.push({
    id: 'rating_gap',
    label: 'Längste Lücke zwischen Ratingständen',
    group: 'Rating',
    value: gap,
    unit: 'Monate',
    status: highIsBad(gap, 'rating_staleness_months'),
    formula: `${window.length} Ratingstände in 48 Monaten`,
    threshold: 'Warnung ≥ 12 Monate, kritisch ≥ 24 Monate',
    source: 'Risk Management (Coface)',
  })
  return kpis
}

function qualityKpis(quality: NonNullable<InternalData['quality']>): Kpi[] {
  const years = Object.keys(quality)
    .map(Number)
    .sort((a, b) => a - b)
  if (!years.length) return []
  const kpis: Kpi[] = []
  const latest = quality[years[years.length - 1]]
  if (latest.ppm !== null && latest.ppm !== undefined) {
    const prev = years
      .slice(-3, -1)
      .map((y) => quality[y].ppm)
      .filter((v): v is number => v !== null && v !== undefined)
    const change = prev.length && mean(prev) > 0 ? latest.ppm / mean(prev) - 1 : 0
    kpis.push({
      id: 'ppm',
      label: 'Reklamationsquote (ppm)',
      group: 'Qualität',
      value: latest.ppm,
      unit: 'ppm',
      status: highIsBad(change, 'ppm_change'),
      formula: prev.length ? `Veränderung ggü. Ø Vorjahre: ${change >= 0 ? '+' : ''}${Math.round(change * 100)} %` : 'Keine Vorjahreswerte',
      threshold: 'Warnung ≥ +25 %, kritisch ≥ +60 % ggü. Vorjahren',
      source: 'Quality Management',
    })
  }
  if (latest.otd !== null && latest.otd !== undefined) {
    kpis.push({
      id: 'otd',
      label: 'Liefertreue',
      group: 'Qualität',
      value: round(latest.otd * 100, 1),
      unit: '%',
      status: lowIsBad(latest.otd, 'otd_latest'),
      formula: `Pünktliche Lieferungen ${years[years.length - 1]}`,
      threshold: 'Warnung ≤ 95 %, kritisch ≤ 90 %',
      source: 'Quality Management',
    })
  }
  return kpis
}

export function computeKpis(d: InternalData): InternalResult {
  const years = spendYears(d)
  const pdHist = [...(d.pd_history ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  let asOf = d.as_of ?? ''
  if (!asOf) {
    const candidates = [...(years.length ? [`${years[years.length - 1]}-12`] : []), ...pdHist.slice(-1).map((p) => p.date.slice(0, 7))]
    asOf = candidates.length ? candidates.sort().slice(-1)[0] : ''
  }
  const forecast = revenueForecast(d)
  const kpis = [
    ...(years.length ? spendKpis(d, years) : []),
    ...planKpis(d, years, forecast),
    ...ratingKpis(pdHist, asOf),
    ...qualityKpis(d.quality ?? {}),
  ]
  const available = new Set(kpis.flatMap((k) => k.source.split(' + ')))
  const snapshots = d.plan_snapshots ?? []
  const nextYear = years.length ? String(years[years.length - 1] + 1) : ''
  return {
    as_of: asOf,
    kpis,
    forecast,
    missing_sources: SOURCES.filter((s) => !available.has(s)),
    series: {
      years,
      revenue: years.map((y) => d.revenue![y]),
      purchase: years.map((y) => d.purchase![y]),
      customer_share: years.map((y) => round((d.purchase![y] / d.revenue![y]) * 100, 1)),
      pd_history: pdHist,
      plan_revisions: snapshots.filter((s) => nextYear in s.volumes).map((s) => ({ date: s.date, volume: s.volumes[nextYear] })),
    },
  }
}
