import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ExternalLink,
  Factory,
  Globe,
  Languages,
  LineChart as LineIcon,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Play,
  ScrollText,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { backend } from '../backend'
import { recipientsFor } from '../engine/pipeline'
import { Rich, useI18n, type T } from '../i18n'
import { KPI_STATUS, STATUS } from '../theme'
import type { Indicator, Meta, Plant, Report, StepState, Supplier, SupplierDetail } from '../types'
import { PdChart, PlanChart, RevenueChart, ShareChart } from './Charts'
import { WebResearchPanel } from './WebResearch'
import { RiskBadge, Section, StatusBadge, StatusIcon } from './ui'

type Tab = 'overview' | 'agents' | 'data' | 'web'

interface Props {
  detail: SupplierDetail
  meta: Meta
  plants: Plant[]
  steps: Record<string, StepState> | null
  running: boolean
  onRun: () => void
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  /** Called after the web signals were changed (artifact, demo). */
  onChanged: () => void
}

// Reports stored before the language switch used German ids for groups and priorities.
const LEGACY_PRIORITY: Record<string, Indicator['priority']> = { finanziell: 'financial', extern: 'external', operativ: 'operational' }
const isExternal = (i?: Indicator) => i?.group === 'external' || i?.group === 'Extern'

export const categoryLabel = (t: T, c: string) => t(`cat.${c}`)

export function addressLine(s: Pick<Supplier, 'street' | 'zip' | 'city' | 'country'>) {
  return [s.street, [s.zip, s.city].filter(Boolean).join(' '), s.country].filter(Boolean).join(', ')
}

export function DetailPanel({ detail, meta, plants, steps, running, onRun, onClose, onEdit, onDelete, onChanged }: Props) {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<Tab>('overview')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { supplier: s, report } = detail
  const linked = plants.filter((p) => s.plant_ids?.includes(p.id))
  const { recipients } = recipientsFor(s, plants)
  const tabs: { id: Tab; label: string; icon: typeof Bot }[] = [
    { id: 'overview', label: t('detail.tab.overview'), icon: ScrollText },
    { id: 'agents', label: t('detail.tab.agents'), icon: Bot },
    { id: 'data', label: t('detail.tab.data'), icon: LineIcon },
    { id: 'web', label: backend.webResearch ? t('detail.tab.web_research') : t('detail.tab.web'), icon: Globe },
  ]
  const address = addressLine(s)
  const reportLang = report?.lang ?? 'de'

  return (
    <aside className="glass pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-2xl md:w-[500px]">
      <header className="border-b border-line p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
              <span className="font-mono">{s.number}</span>·<span>{s.commodity}</span>
              <span className="rounded bg-white/5 px-1.5">{t(`detail.source.${s.source}`)}</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold leading-snug text-ink-1">{s.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
              {address && (
                <span className="flex items-center gap-1" title={s.location?.precision === 'country' ? t('detail.precision.country') : undefined}>
                  <MapPin size={12} /> {address}
                </span>
              )}
              {s.buyer.name && (
                <span className="flex items-center gap-1">
                  <User size={12} /> {s.buyer.name}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
              <Factory size={12} />
              {linked.length ? (
                linked.map((p) => (
                  <span key={p.id} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-ink-2">
                    {p.name}
                  </span>
                ))
              ) : (
                <span>{t('detail.no_plants')}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {confirmDelete ? (
              <>
                <button onClick={onDelete} className="rounded-lg bg-crit/20 px-2 py-1 text-xs font-medium text-[#ff8a8a] hover:bg-crit/30">
                  {t('common.delete')}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-2 py-1 text-xs text-ink-3 hover:text-ink-1">
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onEdit}
                  className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1"
                  aria-label={t('detail.edit')}
                  title={t('detail.edit')}
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-[#ff8a8a]"
                  aria-label={t('detail.delete')}
                  title={t('detail.delete')}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1" aria-label={t('common.close')}>
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
              <span>{t('detail.register')}</span>
              <StatusBadge light={s.register_status} size="sm" />
              <span className="basis-full">{t('detail.as_of', { date: report.as_of || '–', llm: report.llm })}</span>
            </div>
            {report.decision.escalate && (
              <div className="text-xs font-medium text-[#ff8a8a]">
                {t('detail.escalated_to', {
                  names: recipients.length ? recipients.map((r) => r.name || r.email).join(', ') : t('detail.buyer'),
                })}
              </div>
            )}
            {reportLang !== lang && (
              <div className="flex items-start gap-1.5 text-[11px] text-ink-3">
                <Languages size={13} className="mt-px shrink-0" />
                {t('detail.other_lang', { lang: t(`lang.${reportLang}`), current: t(`lang.${lang}`) })}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onRun}
          disabled={running}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {running ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
          {running ? t('detail.running') : t('detail.run')}
        </button>
      </header>

      <nav className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-3 pt-2">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium ${
              tab === x.id ? 'border-accent text-ink-1' : 'border-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            <x.icon size={13} /> {x.label}
          </button>
        ))}
      </nav>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {(running || steps) && tab !== 'agents' && <PipelineMini steps={steps} meta={meta} />}
        {!report ? (
          <p className="mt-6 text-sm text-ink-3">{t('detail.no_report')}</p>
        ) : tab === 'overview' ? (
          <Overview report={report} recipients={recipients} />
        ) : tab === 'agents' ? (
          <Agents report={report} steps={steps} meta={meta} />
        ) : tab === 'data' ? (
          <div className="mt-4 space-y-3">
            <RevenueChart report={report} />
            <ShareChart report={report} />
            <PdChart history={report.series.pd_history} />
            <PlanChart report={report} />
            {!report.series.years.length && !report.series.pd_history.length && <p className="text-sm text-ink-3">{t('detail.no_series')}</p>}
          </div>
        ) : backend.webResearch ? (
          <WebResearchPanel web={backend.webResearch} supplier={s} signals={report.external} onChanged={onChanged} />
        ) : (
          <Web report={report} />
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
  const { t } = useI18n()
  return (
    <div className="rounded-xl border border-line bg-surface-0/50 p-3">
      <div className="text-[11px] text-ink-3">{agent}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-sm text-ink-2">{question}</span>
        {pending ? (
          <span className="text-sm text-ink-3">{t('detail.not_required')}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
            <StatusIcon light={light} size={15} /> {yes ? t('common.yes') : t('common.no')}
          </span>
        )}
      </div>
    </div>
  )
}

function ArgumentChain({ report }: { report: Report }) {
  const { t } = useI18n()
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
            <span className="ml-auto shrink-0 text-[10px] font-normal text-ink-3">
              {a.direction === 'risk' ? t('detail.risk') : t('detail.stability')}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{a.reasoning}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {a.indicator_ids.map((id) => (
              <span key={id} className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-ink-3" title={byId[id]?.evidence}>
                {isExternal(byId[id])
                  ? t('detail.web_chip', { category: categoryLabel(t, byId[id]?.category ?? '') })
                  : (byId[id]?.label ?? id)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Overview({ report: r, recipients }: { report: Report; recipients: ReturnType<typeof recipientsFor>['recipients'] }) {
  const { t, locale } = useI18n()
  return (
    <>
      {r.missing_sources?.length > 0 && (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-ink-2">
          <Rich text={t('detail.incomplete', { sources: r.missing_sources.join(', ') })} />
        </div>
      )}
      <Section title={t('detail.recommendation')}>
        <p className="text-sm leading-relaxed text-ink-1">{r.argumentation.recommendation}</p>
        {r.risk_check.risk && <p className="mt-2 text-xs leading-relaxed text-ink-3">{r.argumentation.summary}</p>}
      </Section>
      {r.risk_check.risk ? (
        <Section title={t('detail.chain')}>
          <ArgumentChain report={r} />
        </Section>
      ) : (
        <Section title={t('detail.reasoning_no_risk')}>
          <p className="text-xs leading-relaxed text-ink-2">{r.risk_check.reasoning}</p>
        </Section>
      )}
      {r.risk_check.risk && (
        <Section title={t('detail.decision', { answer: r.decision.escalate ? t('common.yes') : t('common.no') })}>
          <p className="text-xs leading-relaxed text-ink-2">{r.decision.justification}</p>
        </Section>
      )}
      {r.argumentation.measures.length > 0 && (
        <Section title={t('detail.measures')}>
          <ul className="space-y-1.5">
            {r.argumentation.measures.map((m) => (
              <li key={m} className="flex gap-2 text-sm text-ink-2">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-accent" /> {m}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={t('detail.recipients')}>
        <p className="mb-2 text-[11px] text-ink-3">{t('detail.recipients_hint')}</p>
        {recipients.length ? (
          <ul className="space-y-1">
            {recipients.map((p) => (
              <li key={(p.email || p.name) + p.plant} className="flex items-center gap-2 text-xs text-ink-2">
                <Mail size={12} className="shrink-0 text-ink-3" />
                <span className="text-ink-1">{p.name || p.email}</span>
                {p.email && p.name && <span className="truncate text-ink-3">{p.email}</span>}
                <span className="ml-auto shrink-0 text-[10px] text-ink-3">
                  {p.role === 'buyer' ? t('detail.role.buyer') : [p.role, p.plant].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[#ffc23d]">{t('detail.no_recipients')}</p>
        )}
      </Section>
      <Section title={t('detail.kpis')}>
        {!r.kpis.length && <p className="text-xs text-ink-3">{t('detail.no_kpis')}</p>}
        <div className="grid grid-cols-2 gap-2">
          {r.kpis.map((k) => (
            <div
              key={k.id}
              className="group relative rounded-xl border border-line bg-surface-0/50 p-3"
              title={t('detail.kpi_title', { formula: k.formula, threshold: k.threshold, source: k.source })}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] leading-tight text-ink-3">{k.label}</span>
                <StatusIcon light={KPI_STATUS[k.status]} size={13} />
              </div>
              <div className="mt-1.5 font-mono text-lg font-semibold text-ink-1">
                {k.value.toLocaleString(locale)} <span className="text-xs font-normal text-ink-3">{k.unit}</span>
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
  const { t } = useI18n()
  if (!steps) return null
  return (
    <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t('detail.workflow')}</div>
      <div className="flex gap-1">
        {meta.steps.map((id) => (
          <div key={id} className="flex-1" title={`${t(`step.${id}`)}: ${steps[id]?.summary ?? ''}`}>
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
        {meta.steps.map((id) => (steps[id]?.status === 'running' ? `${t(`step.${id}`)} …` : null)).find(Boolean) ?? t('detail.finished')}
      </div>
    </div>
  )
}

function Agents({ report: r, steps, meta }: { report: Report; steps: Record<string, StepState> | null; meta: Meta }) {
  const { t } = useI18n()
  // Without a live run, steps after "Risk?" count as skipped when no risk was found (Figure 2).
  const skippedWithoutRisk = (id: string) => !r.risk_check.risk && !['internal', 'risk'].includes(id)
  const order = ['risk', 'success', 'neutral']
  return (
    <>
      <Section title={t('detail.workflow_title')}>
        <ol className="relative space-y-0">
          {meta.steps.map((id, i) => {
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
                  <div className="text-[13px] font-medium text-ink-1">{t(`step.${id}`)}</div>
                  <div className="text-[11px] text-ink-3">
                    {st?.summary || (status === 'skipped' ? t('detail.skipped') : t(`step.${id}.desc`))}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </Section>

      <Section title={`Risk? ${r.risk_check.risk ? t('common.yes') : t('common.no')} (${r.risk_check.method})`}>
        <p className="text-xs leading-relaxed text-ink-2">{r.risk_check.reasoning}</p>
      </Section>

      {r.combinations.length > 0 && (
        <Section title={t('detail.combinations')}>
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
        <Section title={t('detail.matrix')}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 font-medium">{t('detail.col.indicator')}</th>
                  <th className="py-1 font-medium">{t('detail.col.type')}</th>
                  <th className="py-1 font-medium">{t('detail.col.strength')}</th>
                  <th className="py-1 font-medium">{t('detail.col.priority')}</th>
                </tr>
              </thead>
              <tbody>
                {[...r.indicators]
                  .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
                  .map((i) => (
                    <tr key={i.id} className="border-t border-line/60" title={i.evidence}>
                      <td className="max-w-[200px] truncate py-1.5 pr-2 text-ink-2">
                        {i.label} <span className="text-ink-3">{!isExternal(i) ? i.value : ''}</span>
                      </td>
                      <td className="py-1.5">
                        <span className={i.type === 'risk' ? 'text-[#ff8a8a]' : i.type === 'success' ? 'text-[#5fd35f]' : 'text-ink-3'}>
                          {t(`detail.type.${i.type}`)}
                        </span>
                      </td>
                      <td className="py-1.5 text-ink-3">{i.type === 'risk' && i.strength ? t(`detail.strength.${i.strength}`) : '–'}</td>
                      <td className="py-1.5 text-ink-3">{t(`detail.priority.${LEGACY_PRIORITY[i.priority] ?? i.priority}`)}</td>
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

function Web({ report: r }: { report: Report }) {
  const { t } = useI18n()
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
              <span>{d.date}</span>·<span>{categoryLabel(t, d.category)}</span>
              <span className="ml-auto flex items-center gap-1">
                {d.signal === 'risk' ? (
                  <StatusBadge light={d.severity === 3 ? 'red' : 'yellow'} size="sm">
                    {t('detail.severity', { n: d.severity })}
                  </StatusBadge>
                ) : d.signal === 'success' ? (
                  <StatusBadge light="green" size="sm">
                    {t('detail.success')}
                  </StatusBadge>
                ) : (
                  <span>{t('detail.type.neutral')}</span>
                )}
              </span>
            </div>
            <div className="mt-1.5 flex items-start gap-1 text-[13px] font-medium text-ink-1">
              {d.title} {d.url && <ExternalLink size={12} className="mt-1 shrink-0 text-ink-3" />}
            </div>
            <div className="mt-1 text-xs text-ink-3">{d.rationale}</div>
          </a>
        ))}
        {!r.external.length && <p className="text-xs text-ink-3">{t('detail.no_docs')}</p>}
      </div>
    </Section>
  )
}
