/**
 * One evaluation of a supplier through all modules (Figure 2), in the browser.
 * TypeScript port of backend/app/pipeline.py for the artifact variant.
 *
 * Internal Module → "Risk?" (AI Agent Internal Data): no → evaluation next quarter;
 * yes → External Module → Decision Module (Figure 4) → "Escalation?" → buyer / result storage.
 */
import type { ExternalDoc, Report, StepState, StreamEvent, Supplier } from '../types'
import * as dm from './decision'
import { computeKpis, type InternalData } from './internal'

export const STEPS: [string, string, string][] = [
  ['internal', 'Internal Module', 'Interne Daten sammeln & KPIs berechnen'],
  ['risk', 'Risk?', 'AI Agent Internal Data: liegt ein Risiko vor?'],
  ['external', 'External Module', 'Web-Signale auswerten'],
  ['mapping', 'Mapping Indicators', 'Datenpunkte → Risiko-/Erfolgsindikatoren'],
  ['crossref', 'Cross-Referencing', 'Indikatoren relativieren, abwägen, Finanzsignale priorisieren'],
  ['argumentation', 'Argumentation Generation', 'Nachvollziehbare Argumentationskette'],
  ['decision', 'AI Decision Making', 'Escalation? und Empfehlung'],
  ['escalation', 'Escalation', 'Benachrichtigung des Einkäufers'],
]

/** Asks Claude for JSON. Rejects when Claude is unavailable; the pipeline then uses its rules. */
export type AskJson = (prompt: string) => Promise<unknown>

export interface PipelineInput {
  supplier: Supplier
  internal: InternalData
  external: ExternalDoc[]
}

export interface PipelineOptions {
  ai: AskJson | null
  aiLabel: string
  onEvent?: (e: StreamEvent) => void
  pace?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runPipeline({ supplier, internal, external }: PipelineInput, opts: PipelineOptions): Promise<Report> {
  const emit = (step: string, status: StepState['status'], summary = '') => opts.onEvent?.({ type: 'step', step, status, summary })
  const pause = () => (opts.pace ? sleep(opts.pace) : Promise.resolve())
  let llmUsed = false
  /** Asks Claude and validates the answer; falls back to the rule-based result. */
  async function agent<T>(prompt: string, validate: (v: unknown) => T | null, fallback: () => T): Promise<[T, string]> {
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
    return [fallback(), 'Regelbasiert']
  }

  emit('internal', 'running')
  await pause()
  const result = computeKpis(internal)
  const flagged = result.kpis.filter((k) => k.status !== 'ok').length
  const missing = result.missing_sources
  emit(
    'internal',
    'done',
    `${result.kpis.length} KPIs berechnet, ${flagged} auffällig` + (missing.length ? `. Keine Daten aus: ${missing.join(', ')}` : ''),
  )

  emit('risk', 'running')
  const [check, riskMethod] = result.kpis.length
    ? await agent(
        dm.riskPrompt(supplier, result.kpis),
        (v) => (dm.validRiskCheck(v) ? v : null),
        () => dm.ruleRiskCheck(result.kpis),
      )
    : [dm.ruleRiskCheck(result.kpis), 'Regelbasiert']
  emit('risk', 'done', `${check.risk ? 'Ja' : 'Nein'} – ${check.reasoning} (${riskMethod})`)

  const report = (fields: Pick<Report, 'indicators' | 'combinations' | 'argumentation' | 'decision' | 'external_origin'>): Report => ({
    supplier_id: supplier.id,
    created_at: new Date().toISOString().slice(0, 19) + '+00:00',
    llm: llmUsed ? opts.aiLabel : 'Regelbasiert (ohne LLM)',
    as_of: result.as_of,
    status: fields.decision.escalate ? 'escalated' : check.risk ? 'risk' : 'none',
    kpis: result.kpis,
    forecast: result.forecast,
    series: result.series,
    risk_check: { ...check, method: riskMethod },
    external,
    missing_sources: missing,
    deliveries: [],
    ...fields,
  })

  if (!check.risk) {
    // Figure 2: no risk → "Risk Evaluation next quarter"; the Decision Module is not needed.
    for (const step of ['external', 'mapping', 'crossref', 'argumentation', 'decision', 'escalation'])
      emit(step, 'skipped', 'Nicht erforderlich (Risk? = nein)')
    return report({
      indicators: [],
      combinations: [],
      external_origin: 'Nicht ausgewertet (Risk? = nein)',
      argumentation: {
        summary: check.reasoning,
        arguments: [],
        recommendation: 'Keine Maßnahme erforderlich – Risikobewertung im nächsten Quartal.',
        measures: [],
      },
      decision: { escalate: false, confidence: 'medium', justification: 'Keine Eskalation, da kein Risiko vorliegt (Risk? = nein).' },
    })
  }

  emit('external', 'running')
  await pause()
  const nRisk = external.filter((d) => d.signal === 'risk').length
  emit(
    'external',
    'done',
    external.length ? `${external.length} Web-Signale, davon ${nRisk} Risikosignal(e)` : 'Keine Web-Signale hinterlegt',
  )

  emit('mapping', 'running')
  await pause()
  const indicators = dm.mapIndicators(result.kpis, external, result.as_of)
  const count = (t: string) => indicators.filter((i) => i.type === t).length
  emit('mapping', 'done', `${count('risk')} Risiko-, ${count('success')} Erfolgs-, ${count('neutral')} neutrale Indikatoren`)

  emit('crossref', 'running')
  await pause()
  const combos = dm.crossReference(indicators)
  const nFin = indicators.filter((i) => i.type === 'risk' && i.priority === 'finanziell').length
  emit('crossref', 'done', `${combos.length} kritische Kombination(en), ${nFin} finanzielle Risikoindikator(en) priorisiert`)

  emit('argumentation', 'running')
  const [argumentation, argMethod] = await agent(
    dm.argumentationPrompt(supplier, indicators, combos),
    (v) => (dm.validArgumentation(v) ? { ...v, measures: v.measures.map(String).slice(0, 5) } : null),
    () => dm.templateArgumentation(indicators, combos),
  )
  emit('argumentation', 'done', `${argumentation.arguments.length} Argumente (${argMethod})`)

  emit('decision', 'running')
  const [agentDecision, decMethod] = await agent(dm.decisionPrompt(supplier, argumentation), dm.validDecision, () =>
    dm.ruleDecision(indicators, combos, supplier.register_status),
  )
  let decision = agentDecision
  if (missing.length) {
    decision = { ...decision, justification: `${decision.justification} Datenlage unvollständig – fehlend: ${missing.join(', ')}.` }
    if (missing.length >= 2) decision.confidence = 'low'
  }
  emit('decision', 'done', `Escalation? ${decision.escalate ? 'Ja' : 'Nein'} (${decMethod})`)

  emit('escalation', 'running')
  await pause()
  emit(
    'escalation',
    'done',
    decision.escalate
      ? `Benachrichtigung für ${supplier.buyer.name || 'den Einkäufer'} im Cockpit abgelegt`
      : 'Keine Eskalation – Ergebnis gespeichert',
  )

  return report({
    indicators,
    combinations: combos,
    external_origin: external.length ? `Gespeicherte Web-Signale: ${external.length}` : 'Keine Web-Signale hinterlegt',
    argumentation,
    decision,
  })
}
