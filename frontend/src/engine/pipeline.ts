/**
 * One evaluation of a supplier through all modules (Figure 2), in the browser.
 * TypeScript port of backend/app/pipeline.py for the artifact and demo variants.
 *
 * Internal Module → "Risk?" (AI Agent Internal Data): no → evaluation next quarter;
 * yes → External Module → Decision Module (Figure 4) → "Escalation?" → buyer and plant contacts / result storage.
 */
import type { ExternalDoc, Plant, Recipient, Report, StepState, StreamEvent, Supplier } from '../types'
import * as dm from './decision'
import { computeKpis, type InternalData } from './internal'
import { tx, type Lang } from './texts'

/** Step ids in workflow order; labels and descriptions are translated by the UI. */
export const STEPS = ['internal', 'risk', 'external', 'mapping', 'crossref', 'argumentation', 'decision', 'escalation']

/** Asks Claude for JSON. Rejects when Claude is unavailable; the pipeline then uses its rules. */
export type AskJson = (prompt: string) => Promise<unknown>

export interface PipelineInput {
  supplier: Supplier
  internal: InternalData
  external: ExternalDoc[]
  plants: Plant[]
}

export interface PipelineOptions {
  ai: AskJson | null
  aiLabel: string
  lang: Lang
  onEvent?: (e: StreamEvent) => void
  pace?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Everyone to warn about a supplier: its buyer and the contacts of every linked plant,
 * without duplicates (same e-mail address). As backend/app/pipeline.py `recipients_for`.
 */
export function recipientsFor(supplier: Supplier, plants: Plant[]): { recipients: Recipient[]; plants: string[] } {
  const people: Recipient[] = []
  if (supplier.buyer.name || supplier.buyer.email) people.push({ ...supplier.buyer, role: 'buyer', plant: '' })
  const linked = (supplier.plant_ids ?? []).map((id) => plants.find((p) => p.id === id)).filter((p): p is Plant => !!p)
  for (const p of linked) for (const c of p.contacts) people.push({ ...c, plant: p.name })
  const seen = new Set<string>()
  const recipients = people.filter((r) => {
    const key = (r.email || r.name).trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { recipients, plants: linked.map((p) => p.name) }
}

export async function runPipeline({ supplier, internal, external, plants }: PipelineInput, opts: PipelineOptions): Promise<Report> {
  const { lang } = opts
  const t = (key: string, vars?: Record<string, unknown>) => tx(lang, key, vars)
  const yesNo = (v: boolean) => t(v ? 'yes' : 'no')
  const emit = (step: string, status: StepState['status'], summary = '') => opts.onEvent?.({ type: 'step', step, status, summary })
  const pause = () => (opts.pace ? sleep(opts.pace) : Promise.resolve())
  let llmUsed = false
  /** Asks Claude and validates the answer; falls back to the rule-based result. */
  async function agent<T>(prompt: string, validate: (v: unknown) => T | null, fallback: () => T, fallbackLabel: string): Promise<[T, string]> {
    if (opts.ai) {
      try {
        const v = validate(await opts.ai(prompt))
        if (v) {
          llmUsed = true
          return [v, opts.aiLabel]
        }
      } catch {
        /* rule-based fallback */
      }
    } else {
      await pause()
    }
    return [fallback(), fallbackLabel]
  }

  emit('internal', 'running')
  await pause()
  const result = computeKpis(internal, lang)
  const flagged = result.kpis.filter((k) => k.status !== 'ok').length
  const missing = result.missing_sources
  emit(
    'internal',
    'done',
    t('step.internal', { n: result.kpis.length, flagged }) + (missing.length ? t('step.internal.missing', { sources: missing.join(', ') }) : ''),
  )

  emit('risk', 'running')
  const [check, riskMethod] = result.kpis.length
    ? await agent(
        dm.riskPrompt(supplier, result.kpis, lang),
        (v) => (dm.validRiskCheck(v) ? v : null),
        () => dm.ruleRiskCheck(result.kpis, lang),
        t('method.rules'),
      )
    : [dm.ruleRiskCheck(result.kpis, lang), t('method.rules')]
  emit('risk', 'done', t('step.risk', { answer: yesNo(check.risk), reasoning: check.reasoning, method: riskMethod }))

  const report = (fields: Pick<Report, 'indicators' | 'combinations' | 'argumentation' | 'decision' | 'external_origin' | 'deliveries'>): Report => ({
    supplier_id: supplier.id,
    created_at: new Date().toISOString().slice(0, 19) + '+00:00',
    llm: llmUsed ? opts.aiLabel : t('llm.rules'),
    lang,
    as_of: result.as_of,
    status: fields.decision.escalate ? 'escalated' : check.risk ? 'risk' : 'none',
    kpis: result.kpis,
    forecast: result.forecast,
    series: result.series,
    risk_check: { ...check, method: riskMethod },
    external,
    missing_sources: missing,
    ...fields,
  })

  if (!check.risk) {
    // Figure 2: no risk → "Risk Evaluation next quarter"; the Decision Module is not needed.
    for (const step of STEPS.slice(2)) emit(step, 'skipped', t('step.skipped'))
    return report({
      indicators: [],
      combinations: [],
      external_origin: t('origin.not_evaluated'),
      argumentation: { summary: check.reasoning, arguments: [], recommendation: t('rec.none'), measures: [] },
      decision: { escalate: false, confidence: 'medium', justification: t('decision.no_risk') },
      deliveries: [],
    })
  }

  emit('external', 'running')
  await pause()
  const origin = external.length ? t('ext.signals', { n: external.length }) : t('ext.no_signals')
  emit('external', 'done', t('step.external.browser', { origin, n: external.filter((d) => d.signal === 'risk').length }))

  emit('mapping', 'running')
  await pause()
  const indicators = dm.mapIndicators(result.kpis, external, result.as_of, lang)
  const count = (type: string) => indicators.filter((i) => i.type === type).length
  emit('mapping', 'done', t('step.mapping', { risk: count('risk'), success: count('success'), neutral: count('neutral') }))

  emit('crossref', 'running')
  await pause()
  const combos = dm.crossReference(indicators, lang)
  const nFin = indicators.filter((i) => i.type === 'risk' && i.priority === 'financial').length
  emit('crossref', 'done', t('step.crossref', { combos: combos.length, fin: nFin }))

  emit('argumentation', 'running')
  const [argumentation, argMethod] = await agent(
    dm.argumentationPrompt(supplier, indicators, combos, lang),
    (v) => (dm.validArgumentation(v) ? { ...v, measures: v.measures.map(String).slice(0, 5) } : null),
    () => dm.templateArgumentation(indicators, combos, lang),
    t('method.template'),
  )
  emit('argumentation', 'done', t('step.argumentation', { n: argumentation.arguments.length, method: argMethod }))

  emit('decision', 'running')
  const [agentDecision, decMethod] = await agent(
    dm.decisionPrompt(supplier, argumentation, lang),
    dm.validDecision,
    () => dm.ruleDecision(indicators, combos, supplier.register_status, lang),
    t('method.rules'),
  )
  let decision = agentDecision
  if (missing.length) {
    decision = { ...decision, justification: decision.justification + t('decision.missing', { sources: missing.join(', ') }) }
    if (missing.length >= 2) decision.confidence = 'low'
  }
  emit('decision', 'done', t('step.decision', { answer: yesNo(decision.escalate), method: decMethod }))

  emit('escalation', 'running')
  await pause()
  const deliveries: Report['deliveries'] = []
  if (decision.escalate) {
    // In the browser there is no mail server: one cockpit notification names every recipient.
    const { recipients, plants: plantNames } = recipientsFor(supplier, plants)
    const display = recipients.map((r) => (r.email ? `${r.name || r.email} <${r.email}>` : r.name)).join(', ')
    const body = [
      argumentation.summary,
      plantNames.length ? t('mail.plants', { plants: plantNames.join(', ') }) : '',
      t('mail.plain_recommendation', { text: argumentation.recommendation }),
    ]
      .filter(Boolean)
      .join('\n\n')
    deliveries.push({
      supplier_id: supplier.id,
      created_at: new Date().toISOString().slice(0, 19) + '+00:00',
      recipient: display || '–',
      recipients,
      plants: plantNames,
      subject: t('mail.subject', { name: supplier.name, number: supplier.number }),
      body,
      channel: 'inapp',
      status: 'sent',
      error: '',
    })
    emit(
      'escalation',
      'done',
      t('step.escalation.sent', { recipients: recipients.map((r) => r.name || r.email).join(', ') || '–', channels: t('channel.cockpit') }),
    )
  } else {
    emit('escalation', 'done', t('step.escalation.none'))
  }

  return report({ indicators, combinations: combos, external_origin: origin, argumentation, decision, deliveries })
}
