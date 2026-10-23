import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SERIES, STATUS, fmt } from '../theme'
import type { Report } from '../types'

const axis = { stroke: '#3a4352', tick: { fill: '#8b8a83', fontSize: 11 }, tickLine: false }
const grid = <CartesianGrid stroke="#1c232e" vertical={false} />
const tooltipStyle = {
  contentStyle: { background: '#0e1218', border: '1px solid #232a35', borderRadius: 10, fontSize: 12, color: '#f0efec' },
  labelStyle: { color: '#c3c2b7' },
  cursor: { stroke: '#3a4352' },
}
const legend = <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: '#c3c2b7' }} />

function ChartCard({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-0/50 p-3">
      <div className="mb-1 text-xs font-medium text-ink-2">{title}</div>
      <div className="h-44">{children}</div>
      {note && <div className="mt-1 text-[11px] text-ink-3">{note}</div>}
    </div>
  )
}

export function RevenueChart({ report }: { report: Report }) {
  const { years, revenue } = report.series
  if (!years.length) return null
  const data: { year: number; ist?: number; prognose?: number }[] = years.map((y, i) => ({ year: y, ist: revenue[i] }))
  data[data.length - 1].prognose = revenue[revenue.length - 1]
  report.forecast.forEach((f) => data.push({ year: f.year, prognose: f.revenue }))
  return (
    <ChartCard title="Lieferantenumsatz (Mio. €)" note="Prognose = Planvolumen + fortgeschriebenes Fremdgeschäft">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          {grid}
          <XAxis dataKey="year" {...axis} />
          <YAxis {...axis} domain={['auto', 'auto']} />
          <Tooltip {...tooltipStyle} formatter={(v: number) => `${fmt(v, 2)} Mio. €`} />
          {legend}
          <Line dataKey="ist" name="Ist" stroke={SERIES.actual} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} activeDot={{ r: 5 }} />
          <Line dataKey="prognose" name="KI-Prognose" stroke={SERIES.forecast} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function ShareChart({ report }: { report: Report }) {
  if (!report.series.years.length) return null
  const data = report.series.years.map((y, i) => ({ year: y, share: report.series.customer_share[i] }))
  return (
    <ChartCard title="Customer-Share (%)" note="Anteil des Lieferantenumsatzes, der auf den Abnehmer entfällt">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          {grid}
          <XAxis dataKey="year" {...axis} />
          <YAxis {...axis} domain={[0, 100]} />
          <Tooltip {...tooltipStyle} formatter={(v: number) => `${fmt(v)} %`} />
          <ReferenceLine y={50} stroke={STATUS.red.color} strokeDasharray="4 4" label={{ value: 'Grenze 50 %', fill: '#c3c2b7', fontSize: 10, position: 'insideTopRight' }} />
          <Line dataKey="share" name="Customer-Share" stroke={SERIES.actual} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function PdChart({ history }: { history: { date: string; pd: number }[] }) {
  if (!history.length) return null
  return (
    <ChartCard title="Coface-Ausfallwahrscheinlichkeit (PD, %)" note="Ratingstände; Gelb ab 1 %, Rot ab 3 %">
      <ResponsiveContainer>
        <LineChart data={history} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          {grid}
          <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => d.slice(0, 7)} />
          <YAxis {...axis} domain={[0, (max: number) => Math.max(4, Math.ceil(max + 0.5))]} />
          <Tooltip {...tooltipStyle} formatter={(v: number) => `${fmt(v, 2)} %`} />
          <ReferenceLine y={1} stroke={STATUS.yellow.color} strokeDasharray="4 4" />
          <ReferenceLine y={3} stroke={STATUS.red.color} strokeDasharray="4 4" />
          <Line type="stepAfter" dataKey="pd" name="PD" stroke={SERIES.actual} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function PlanChart({ report }: { report: Report }) {
  const data = report.series.plan_revisions
  if (data.length < 2) return null
  const year = report.series.years[report.series.years.length - 1] + 1
  return (
    <ChartCard title={`Planstände Einkaufsvolumen ${year} (Mio. €)`} note="Schwankende Planstände signalisieren Planungsunsicherheit">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          {grid}
          <XAxis dataKey="date" {...axis} />
          <YAxis {...axis} domain={['auto', 'auto']} />
          <Tooltip {...tooltipStyle} formatter={(v: number) => `${fmt(v, 2)} Mio. €`} />
          <Line dataKey="volume" name="Planvolumen" stroke={SERIES.actual} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
