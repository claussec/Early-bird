/**
 * One evaluation of a supplier through all modules (Figure 2), in the browser.
 * TypeScript port of backend/app/pipeline.py for the artifact variant.
 */
import type { ExternalDoc, Light, Report, StreamEvent, Supplier } from '../types'
import * as dm from './decision'
import { computeKpis, type InternalData } from './internal'

export const STEPS: [string, string, string][] = [
  ['internal', 'Internal Module', 'Interne Daten sammeln & KPIs berechnen'],
  ['external', 'External Module', 'Web-Signale auswerten'],
  ['mapping', 'Mapping Indicators', 'Datenpunkte → Risiko-/Erfolgsindikatoren'],
  ['crossref', 'Cross-Referencing', 'Indikatoren relativieren & kombinieren'],
  ['argumentation', 'Argumentation Generation', 'Nachvollziehbare Argumentationskette'],
  ['decision', 'AI Decision Making', 'Ampel & Eskalationsentscheidung'],
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
  const emit = (step: string, status: 'running' | 'done', summary = '') => opts.onEvent?.({ type: 'step', step, status, summary })
  const pause = () => (opts.pace ? sleep(opts.pace) : Promise.resolve())

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
  const scoring = dm.score(indicators, combos)
  emit('crossref', 'done', `${combos.length} kritische Kombination(en), Score ${scoring.score}/100`)

  emit('argumentation', 'running')
  let argumentation = dm.templateArgumentation(indicators, combos, scoring.traffic_light)
  let argMethod = 'Regelbasierte Vorlage'
  let llmUsed = false
  if (opts.ai) {
    try {
      const v = await opts.ai(dm.argumentationPrompt(supplier, indicators, combos, scoring))
      if (dm.validArgumentation(v)) {
        argumentation = { ...v, measures: v.measures.map(String).slice(0, 5) }
        argMethod = opts.aiLabel
        llmUsed = true
      }
    } catch {
      /* rule-based fallback */
    }
  } else {
    await pause()
  }
  emit('argumentation', 'done', `${argumentation.arguments.length} Argumente (${argMethod})`)

  emit('decision', 'running')
  const baseline = dm.ruleDecision(scoring, supplier.register_status, combos)
  let decision = baseline
  let decMethod = 'Regelbasiert'
  if (opts.ai) {
    try {
      const guarded = dm.guardDecision(
        await opts.ai(dm.decisionPrompt(supplier, scoring, argumentation)),
        baseline,
        supplier.register_status,
      )
      if (guarded) {
        decision = guarded
        decMethod = opts.aiLabel
        llmUsed = true
      }
    } catch {
      /* rule-based fallback */
    }
  } else {
    await pause()
  }
  if (missing.length) {
    decision = { ...decision, justification: `${decision.justification} Datenlage unvollständig – fehlend: ${missing.join(', ')}.` }
    if (missing.length >= 2) decision.confidence = 'low'
  }
  emit(
    'decision',
    'done',
    `Ampel ${dm.LIGHT_DE[decision.traffic_light as Light]}, Eskalation: ${decision.escalate ? 'ja' : 'nein'} (${decMethod})`,
  )

  emit('escalation', 'running')
  await pause()
  emit(
    'escalation',
    'done',
    decision.escalate
      ? `Benachrichtigung für ${supplier.buyer.name || 'den Einkäufer'} im Cockpit abgelegt`
      : 'Keine Eskalation – Ergebnis gespeichert',
  )

  return {
    supplier_id: supplier.id,
    created_at: new Date().toISOString().slice(0, 19) + '+00:00',
    llm: llmUsed ? opts.aiLabel : 'Regelbasiert (ohne LLM)',
    as_of: result.as_of,
    kpis: result.kpis,
    forecast: result.forecast,
    series: result.series,
    external,
    external_origin: external.length ? `Gespeicherte Web-Signale: ${external.length}` : 'Keine Web-Signale hinterlegt',
    indicators,
    combinations: combos,
    scoring,
    argumentation,
    decision,
    missing_sources: missing,
    deliveries: [],
  }
}
