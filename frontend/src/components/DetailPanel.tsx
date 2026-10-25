import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ExternalLink,
  Globe,
  LineChart as LineIcon,
  Loader2,
  Play,
  ScrollText,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { KPI_STATUS, STATUS } from '../theme'
import type { Meta, StepState, SupplierDetail } from '../types'
import { backend } from '../backend'
import { PdChart, PlanChart, RevenueChart, ShareChart } from './Charts'
import { WebResearchPanel } from './WebResearch'
import { RiskBadge, Section, StatusBadge, StatusIcon } from './ui'

type Tab = 'overview' | 'agents' | 'data' | 'web'

const SOURCE_LABEL: Record<string, string> = { manual: 'Manuell erfasst', demo: 'Demodaten', sap: 'SAP', erp: 'ERP' }
const WEB_LABEL = backend.webResearch ? 'Web-Recherche' : 'Web'

interface Props {
  detail: SupplierDetail
  meta: Meta
  steps: Record<string, StepState> | null
  running: boolean
  onRun: () => void
  onClose: () => void
  onDelete: () => void
  /** Called after the web signals were changed (artifact). */
  onChanged: () => void
}

export function DetailPanel({ detail, meta, steps, running, onRun, onClose, onDelete, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { supplier: s, report } = detail
  const tabs: { id: Tab; label: string; icon: typeof Bot }[] = [
    { id: 'overview', label: 'Übersicht', icon: ScrollText },
    { id: 'agents', label: 'KI-Agenten', icon: Bot },
    { id: 'data', label: 'Daten', icon: LineIcon },
    { id: 'web', label: WEB_LABEL, icon: Globe },
  ]
  const activeTab = tab

  return (
    <aside className="glass pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-2xl md:w-[500px]">
      <header className="border-b border-line p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] text-ink-3">
              <span className="font-mono">{s.number}</span>·<span>{s.commodity}</span>
              <span className="rounded bg-white/5 px-1.5">{SOURCE_LABEL[s.source] ?? s.source}</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold leading-snug text-ink-1">{s.name}</h2>
            <div className="mt-1 flex items-center gap-3 text-xs text-ink-3">
              {(s.city || s.country) && <span>{[s.city, s.country].filter(Boolean).join(', ')}</span>}
              {s.buyer.name && (
                <span className="flex items-center gap-1">
                  <User size={12} /> {s.buyer.name}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {confirmDelete ? (
              <>
                <button onClick={onDelete} className="rounded-lg bg-crit/20 px-2 py-1 text-xs font-medium text-[#ff8a8a] hover:bg-crit/30">
                  Löschen
                </button>
                <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-2 py-1 text-xs text-ink-3 hover:text-ink-1">
                  Abbrechen
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-[#ff8a8a]"
                aria-label="Lieferant löschen"
                title="Lieferant löschen"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1" aria-label="Schließen">
              <X size={18} />
            </button>
          </div>
        </div>

        {report && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <DecisionTile
                question="Risk?"
                agent="AI Agent Internal Data"
                yes={report.risk_check.risk}
                light={report.risk_check.risk ? 'yellow' : 'green'}
              />
              <DecisionTile
                question="Escalation?"
                agent="AI Agent Decision Maker"
                yes={report.decision.escalate}
                light={report.decision.escalate ? 'red' : 'green'}
                pending={!report.risk_check.risk}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
              <RiskBadge status={report.status} size="sm" />
              <span>Risikoregister:</span>
              <StatusBadge light={s.register_status} size="sm" />
              <span className="basis-full">
                Datenstand {report.as_of || '–'} · {report.llm}
              </span>
            </div>
            {report.decision.escalate && (
              <div className="text-xs font-medium text-[#ff8a8a]">Eskaliert an {s.buyer.name || 'den Einkäufer'}</div>
            )}
          </div>
        )}

        <button
          onClick={onRun}
          disabled={running}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {running ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
          {running ? 'Agenten analysieren …' : 'Analyse jetzt ausführen'}
        </button>
      </header>

      <nav className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium ${
              activeTab === t.id ? 'border-accent text-ink-1' : 'border-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </nav>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {(running || steps) && activeTab !== 'agents' && <PipelineMini steps={steps} meta={meta} />}
        {!report ? (
          <p className="mt-6 text-sm text-ink-3">Noch keine Bewertung vorhanden.</p>
        ) : activeTab === 'overview' ? (
          <Overview detail={detail} />
        ) : activeTab === 'agents' ? (
          <Agents detail={detail} steps={steps} meta={meta} />
        ) : activeTab === 'data' ? (
          <div className="mt-4 space-y-3">
            <RevenueChart report={report} />
            <ShareChart report={report} />
            <PdChart history={report.series.pd_history} />
            <PlanChart report={report} />
            {!report.series.years.length && !report.series.pd_history.length && (
              <p className="text-sm text-ink-3">Für diesen Lieferanten sind noch keine Zeitreihen hinterlegt.</p>
            )}
          </div>
        ) : backend.webResearch ? (
          <WebResearchPanel web={backend.webResearch} supplier={s} signals={report.external} onChanged={onChanged} />
        ) : (
          <Web detail={detail} />
        )}
      </div>
    </aside>
  )
}

function DecisionTile({
  question,
  agent,
  yes,
  light,
  pending,
}: {
  question: string
  agent: string
  yes: boolean
  light: 'green' | 'yellow' | 'red'
  pending?: boolean
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-0/50 p-3">
      <div className="text-[11px] text-ink-3">{agent}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-sm text-ink-2">{question}</span>
        {pending ? (
          <span className="text-sm text-ink-3">nicht erforderlich</span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
            <StatusIcon light={light} size={15} /> {yes ? 'Ja' : 'Nein'}
          </span>
        )}
      </div>
    </div>
  )
}

function ArgumentChain({ report }: { report: NonNullable<SupplierDetail['report']> }) {
  const byId = Object.fromEntries(report.indicators.map((i) => [i.id, i]))
  if (!report.argumentation.arguments.length) return <p className="text-xs text-ink-3">{report.argumentation.summary}</p>
  return (
    <div className="space-y-2">
      {report.argumentation.arguments.map((a, i) => (
        <div
          key={i}
          className="rounded-xl border bg-surface-0/50 p-3"
          style={{ borderColor: a.direction === 'risk' ? '#d03b3b55' : '#0ca30c55' }}
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink-1">
            {a.direction === 'risk' ? (
              <ArrowUpRight size={15} color={STATUS.red.color} />
            ) : (
              <ArrowDownRight size={15} color={STATUS.green.color} />
            )}
            {a.title}
            <span className="ml-auto shrink-0 text-[10px] font-normal text-ink-3">{a.direction === 'risk' ? 'Risiko' : 'Stabilität'}</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{a.reasoning}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {a.indicator_ids.map((id) => (
              <span key={id} className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-ink-3" title={byId[id]?.evidence}>
                {byId[id]?.group === 'Extern' ? `Web: ${byId[id]?.category}` : (byId[id]?.label ?? id)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Overview({ detail }: { detail: SupplierDetail }) {
  const r = detail.report!
  return (
    <>
      {r.missing_sources?.length > 0 && (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-ink-2">
          <b className="text-ink-1">Datenlage unvollständig.</b> Keine Daten aus: {r.missing_sources.join(', ')}. Die Bewertung stützt sich
          nur auf die vorhandenen Quellen.
        </div>
      )}
      <Section title="Empfehlung">
        <p className="text-sm leading-relaxed text-ink-1">{r.argumentation.recommendation}</p>
        {r.risk_check.risk && <p className="mt-2 text-xs leading-relaxed text-ink-3">{r.argumentation.summary}</p>}
      </Section>
      {r.risk_check.risk ? (
        <Section title="Argumentationskette">
          <ArgumentChain report={r} />
        </Section>
      ) : (
        <Section title="Begründung (Risk? = nein)">
          <p className="text-xs leading-relaxed text-ink-2">{r.risk_check.reasoning}</p>
        </Section>
      )}
      {r.risk_check.risk && (
        <Section title={`Entscheidung: Escalation? ${r.decision.escalate ? 'Ja' : 'Nein'}`}>
          <p className="text-xs leading-relaxed text-ink-2">{r.decision.justification}</p>
        </Section>
      )}
      {r.argumentation.measures.length > 0 && (
        <Section title="Maßnahmen">
          <ul className="space-y-1.5">
            {r.argumentation.measures.map((m) => (
              <li key={m} className="flex gap-2 text-sm text-ink-2">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-accent" /> {m}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Kennzahlen (Internal Module)">
        {!r.kpis.length && <p className="text-xs text-ink-3">Keine Kennzahlen hinterlegt.</p>}
        <div className="grid grid-cols-2 gap-2">
          {r.kpis.map((k) => (
            <div
              key={k.id}
              className="group relative rounded-xl border border-line bg-surface-0/50 p-3"
              title={`${k.formula}\nSchwelle: ${k.threshold}\nQuelle: ${k.source}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] leading-tight text-ink-3">{k.label}</span>
                <StatusIcon light={KPI_STATUS[k.status]} size={13} />
              </div>
              <div className="mt-1.5 font-mono text-lg font-semibold text-ink-1">
                {k.value.toLocaleString('de-DE')} <span className="text-xs font-normal text-ink-3">{k.unit}</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-ink-3">{k.threshold}</div>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function PipelineMini({ steps, meta }: { steps: Record<string, StepState> | null; meta: Meta }) {
  if (!steps) return null
  return (
    <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Agenten-Workflow</div>
      <div className="flex gap-1">
        {meta.steps.map(([id, label]) => (
          <div key={id} className="flex-1" title={`${label}: ${steps[id]?.summary ?? ''}`}>
            <div
              className={`h-1.5 rounded-full transition ${
                steps[id]?.status === 'done'
                  ? 'bg-accent'
                  : steps[id]?.status === 'running'
                    ? 'animate-pulse bg-accent/60'
                    : steps[id]?.status === 'skipped'
                      ? 'bg-ink-3/30'
                      : 'bg-line'
              }`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-ink-2">
        {meta.steps.map(([id, label]) => (steps[id]?.status === 'running' ? `${label} …` : null)).find(Boolean) ?? 'Abgeschlossen'}
      </div>
    </div>
  )
}

function Agents({ detail, steps, meta }: { detail: SupplierDetail; steps: Record<string, StepState> | null; meta: Meta }) {
  const r = detail.report!
  // Without a live run, steps after "Risk?" count as skipped when no risk was found (Figure 2).
  const skippedWithoutRisk = (id: string) => !r.risk_check.risk && !['internal', 'risk'].includes(id)
  return (
    <>
      <Section title="Workflow (Reference Model)">
        <ol className="relative space-y-0">
          {meta.steps.map(([id, label, desc], i) => {
            const st = steps?.[id]
            const status = st?.status ?? (skippedWithoutRisk(id) ? 'skipped' : 'done')
            return (
              <li key={id} className="relative flex gap-3 pb-3">
                {i < meta.steps.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-line" />}
                <span
                  className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                    status === 'done'
                      ? 'border-accent bg-accent/20 text-accent'
                      : status === 'running'
                        ? 'border-accent text-accent'
                        : 'border-line text-ink-3'
                  }`}
                >
                  {status === 'running' ? <Loader2 size={12} className="spin" /> : status === 'skipped' ? '–' : i + 1}
                </span>
                <div className={`min-w-0 ${status === 'skipped' ? 'opacity-50' : ''}`}>
                  <div className="text-[13px] font-medium text-ink-1">{label}</div>
                  <div className="text-[11px] text-ink-3">
                    {st?.summary || (status === 'skipped' ? 'Nicht erforderlich (Risk? = nein)' : desc)}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </Section>

      <Section title={`Risk? ${r.risk_check.risk ? 'Ja' : 'Nein'} (${r.risk_check.method})`}>
        <p className="text-xs leading-relaxed text-ink-2">{r.risk_check.reasoning}</p>
      </Section>

      {r.combinations.length > 0 && (
        <Section title="Cross-Referencing: Kombinationen">
          <ul className="space-y-1.5">
            {r.combinations.map((c) => (
              <li key={c.id} className="text-xs leading-relaxed text-ink-2">
                <b className="text-ink-1">{c.title}:</b> {c.description}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.indicators.length > 0 && (
        <Section title="Indikator-Matrix (Mapping Indicators)">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 font-medium">Indikator</th>
                  <th className="py-1 font-medium">Typ</th>
                  <th className="py-1 font-medium">Ausprägung</th>
                  <th className="py-1 font-medium">Priorität</th>
                </tr>
              </thead>
              <tbody>
                {[...r.indicators]
                  .sort((a, b) => ['risk', 'success', 'neutral'].indexOf(a.type) - ['risk', 'success', 'neutral'].indexOf(b.type))
                  .map((i) => (
                    <tr key={i.id} className="border-t border-line/60" title={i.evidence}>
                      <td className="max-w-[200px] truncate py-1.5 pr-2 text-ink-2">
                        {i.label} <span className="text-ink-3">{i.group !== 'Extern' ? i.value : ''}</span>
                      </td>
                      <td className="py-1.5">
                        {i.type === 'risk' ? (
                          <span className="text-[#ff8a8a]">Risiko</span>
                        ) : i.type === 'success' ? (
                          <span className="text-[#5fd35f]">Erfolg</span>
                        ) : (
                          <span className="text-ink-3">neutral</span>
                        )}
                      </td>
                      <td className="py-1.5 text-ink-3">{i.type === 'risk' ? (i.strength === 'strong' ? 'deutlich' : 'schwach') : '–'}</td>
                      <td className="py-1.5 text-ink-3">{i.priority}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  )
}

function Web({ detail }: { detail: SupplierDetail }) {
  const r = detail.report!
  return (
    <Section title="External Module">
      <p className="mb-3 text-xs text-ink-3">{r.external_origin}</p>
      <div className="space-y-2">
        {r.external.map((d, i) => (
          <a
            key={i}
            href={d.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl border border-line bg-surface-0/50 p-3 transition hover:border-ink-3/40"
          >
            <div className="flex items-center gap-2 text-[11px] text-ink-3">
              <span>{d.date}</span>·<span>{d.category}</span>
              <span className="ml-auto flex items-center gap-1">
                {d.signal === 'risk' ? (
                  <StatusBadge light={d.severity === 3 ? 'red' : 'yellow'} size="sm">
                    Risiko · Schwere {d.severity}
                  </StatusBadge>
                ) : d.signal === 'success' ? (
                  <StatusBadge light="green" size="sm">
                    Erfolg
                  </StatusBadge>
                ) : (
                  <span>neutral</span>
                )}
              </span>
            </div>
            <div className="mt-1.5 flex items-start gap-1 text-[13px] font-medium text-ink-1">
              {d.title} {d.url && <ExternalLink size={12} className="mt-1 shrink-0 text-ink-3" />}
            </div>
            <div className="mt-1 text-xs text-ink-3">{d.rationale}</div>
          </a>
        ))}
        {!r.external.length && <p className="text-xs text-ink-3">Keine externen Dokumente.</p>}
      </div>
    </Section>
  )
}
