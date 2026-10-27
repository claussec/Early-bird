/**
 * Decision Module (Figure 4) and the Internal Data agent's "Risk?" check (Figure 2) –
 * TypeScript port of backend/app/modules/decision_module.py and internal_module.risk_check
 * for the in-browser variants. Keep both in sync.
 *
 * Following the paper there is no numeric score: the result is the argumentation and the
 * decisions "Risk?" and "Escalation?".
 */
import type { Combination, ExternalDoc, Indicator, Kpi, Light, Report } from '../types'
import { tx, type Lang } from './texts'

const FINANCIAL_GROUPS = ['rating', 'revenue', 'dependency', 'planning']
const PRIORITY: Record<Indicator['priority'], number> = { financial: 0, external: 1, operational: 2 }
const LIGHT_NAMES: Record<Lang, Record<Light, string>> = {
  de: { green: 'Grün', yellow: 'Gelb', red: 'Rot' },
  en: { green: 'green', yellow: 'yellow', red: 'red' },
}
const EXTERNAL_MAX_AGE_YEARS = 2

export type RiskCheck = { risk: boolean; reasoning: string }
export type Argumentation = Report['argumentation']
export type Decision = Report['decision']

const JSON_ONLY = 'Answer only with JSON in exactly this form:'

// --- AI Agent "Internal Data": Risk? ---------------------------------------------------

export function ruleRiskCheck(kpis: Kpi[], lang: Lang): RiskCheck {
  if (!kpis.length) return { risk: false, reasoning: tx(lang, 'risk.no_kpis') }
  const flagged = kpis.filter((k) => k.status !== 'ok')
  if (!flagged.length) return { risk: false, reasoning: tx(lang, 'risk.all_ok') }
  const listed = flagged
    .slice(0, 5)
    .map((k) => tx(lang, 'risk.item', { label: k.label, value: k.value, unit: k.unit, threshold: k.threshold }))
    .join('; ')
  return { risk: true, reasoning: tx(lang, 'risk.flagged', { n: flagged.length, listed }) }
}

const SYSTEM_RISK =
  "You are the AI agent 'Internal Data' of an early-warning system for financially critical suppliers in " +
  'automotive purchasing. You receive a supplier\'s key figures computed from internal systems, each with ' +
  'formula, threshold and source. Decide whether there are signs of a financial risk (risk = true), so that the ' +
  'supplier is analysed in depth in the Decision Module, or whether it is re-evaluated next quarter ' +
  '(risk = false). Give a short, factual reasoning that cites the specific key figures. Do not invent values ' +
  'and do not assign a score.'

export function riskPrompt(supplier: { name: string; commodity: string }, kpis: Kpi[], lang: Lang) {
  return `${SYSTEM_RISK}

${tx(lang, 'language')}

Supplier: ${supplier.name} (${supplier.commodity}).

Key figures:
${kpis.map((k) => `- ${k.label}: ${k.value} ${k.unit} – ${k.formula} (${k.threshold}; ${k.source})`).join('\n')}

${JSON_ONLY}
{"risk": boolean, "reasoning": string}`
}

export function validRiskCheck(v: unknown): v is RiskCheck {
  const r = v as RiskCheck
  return !!r && typeof r.risk === 'boolean' && typeof r.reasoning === 'string'
}

// --- Step 1: Mapping indicators (standardized matrix) ---------------------------------

function isSuccess(k: Kpi) {
  const v = k.value
  const rules: Record<string, boolean> = {
    customer_share: v < 20,
    customer_share_delta: v <= -2,
    revenue_cagr: v >= 3,
    revenue_forecast: v >= 3,
    plan_change: v >= 3,
    pd_latest: v < 0.5,
    pd_trend: v <= -0.5,
  }
  return rules[k.id] ?? false
}

export function mapIndicators(kpis: Kpi[], external: ExternalDoc[], asOf: string, lang: Lang): Indicator[] {
  const indicators: Indicator[] = kpis.map((k) => {
    let type: Indicator['type'] = 'neutral'
    let strength: Indicator['strength'] = null
    if (k.status === 'critical' || k.status === 'warn') {
      type = 'risk'
      strength = k.status === 'critical' ? 'strong' : 'weak'
    } else if (isSuccess(k)) {
      type = 'success'
      strength = 'weak'
    }
    return {
      id: k.id,
      label: k.label,
      group: k.group,
      type,
      strength,
      priority: FINANCIAL_GROUPS.includes(k.group) ? 'financial' : 'operational',
      value: `${k.value} ${k.unit}`,
      source: k.source,
      evidence: tx(lang, 'ind.threshold', { formula: k.formula, threshold: k.threshold }),
    }
  })
  const refYear = asOf ? Number(asOf.slice(0, 4)) : new Date().getFullYear()
  external.forEach((doc, i) => {
    if (doc.signal === 'neutral') return
    const age = doc.date ? Math.max(0, refYear - Number(doc.date.slice(0, 4))) : null
    let strength: Indicator['strength'] = doc.severity === 3 ? 'strong' : 'weak'
    let note = ''
    if (age !== null && age >= EXTERNAL_MAX_AGE_YEARS) {
      strength = 'weak'
      note = tx(lang, 'ind.old_signal', { age })
    }
    indicators.push({
      id: `ext_${i}`,
      label: doc.title,
      group: 'external',
      category: doc.category,
      type: doc.signal,
      strength,
      severity: doc.severity,
      priority: 'external',
      value: doc.category,
      source: doc.source || 'Web',
      evidence: doc.rationale + note,
      date: doc.date,
      url: doc.url,
    })
  })
  return indicators
}

// --- Step 2: Cross-referencing --------------------------------------------------------

export function prioritized(indicators: Indicator[], type: Indicator['type']) {
  return indicators
    .filter((i) => i.type === type)
    .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || (a.strength === 'strong' ? 0 : 1) - (b.strength === 'strong' ? 0 : 1))
}

const combo = (id: string, indicator_ids: string[], lang: Lang): Combination => ({
  id,
  title: tx(lang, `combo.${id}`),
  description: tx(lang, `combo.${id}.desc`),
  indicator_ids,
})

export function crossReference(indicators: Indicator[], lang: Lang): Combination[] {
  const byId = Object.fromEntries(indicators.map((i) => [i.id, i]))
  const risk = (id: string) => byId[id]?.type === 'risk'
  const extRisk = indicators.filter((i) => i.group === 'external' && i.type === 'risk')
  const finRisk = indicators.filter((i) => (i.group === 'rating' || i.group === 'revenue') && i.type === 'risk')
  const combos: Combination[] = []
  if (risk('customer_share') && (risk('revenue_forecast') || risk('plan_change')))
    combos.push(combo('dependency_decline', ['customer_share', 'revenue_forecast', 'plan_change'].filter(risk), lang))
  if ((risk('pd_trend') || risk('pd_latest')) && risk('plan_volatility'))
    combos.push(combo('rating_planning', ['pd_latest', 'pd_trend', 'plan_volatility'].filter(risk), lang))
  if (risk('rating_gap') && risk('pd_trend')) combos.push(combo('rating_lag', ['rating_gap', 'pd_trend'], lang))
  if (extRisk.length && finRisk.length)
    combos.push(combo('external_confirms', [...extRisk.slice(0, 3), ...finRisk.slice(0, 2)].map((i) => i.id), lang))
  // Web signals with at least a clear warning (severity 2 of 3).
  const severeExt = extRisk.filter((i) => (i.severity ?? 1) >= 2)
  if (severeExt.length >= 2 && !finRisk.length)
    combos.push(combo('divergence', severeExt.slice(0, 3).map((i) => i.id), lang))
  return combos
}

// --- Step 3: Argumentation ------------------------------------------------------------

const MEASURES: Record<string, string> = {
  customer_share: 'measure.customer_share',
  pd_latest: 'measure.financials',
  pd_trend: 'measure.financials',
  plan_volatility: 'measure.plan_volatility',
  revenue_forecast: 'measure.revenue_forecast',
  plan_change: 'measure.plan_change',
  external: 'measure.external',
  ppm: 'measure.ppm',
  otd: 'measure.otd',
}

/**
 * Transparent escalation rule without an LLM: at least one combination from the
 * cross-referencing, or a financial (or financially relevant external) risk indicator clearly
 * above its threshold. Quality indicators alone never escalate.
 */
export function escalationTriggers(indicators: Indicator[], combos: Combination[], lang: Lang): string[] {
  const triggers = combos.map((c) => tx(lang, 'trigger.combo', { title: c.title }))
  for (const i of prioritized(indicators, 'risk')) {
    if (i.strength === 'strong' && (i.priority === 'financial' || i.priority === 'external')) {
      triggers.push(i.priority === 'financial' ? `${i.label} (${i.value})` : tx(lang, 'trigger.web', { label: i.label }))
    }
  }
  return triggers
}

export function templateArgumentation(indicators: Indicator[], combos: Combination[], lang: Lang): Argumentation {
  const args: Argumentation['arguments'] = []
  const covered = new Set<string>()
  combos.forEach((c) => {
    args.push({ title: c.title, direction: 'risk', reasoning: c.description, indicator_ids: c.indicator_ids })
    c.indicator_ids.forEach((id) => covered.add(id))
  })
  const risks = prioritized(indicators, 'risk')
  for (const i of risks) {
    if (covered.has(i.id) || args.length >= 6) continue
    args.push({
      title: i.label,
      direction: 'risk',
      reasoning: tx(lang, 'ind.risk_reasoning', {
        label: i.label,
        value: i.value,
        strength: tx(lang, `strength.${i.strength ?? 'weak'}`),
        evidence: i.evidence,
        source: i.source,
      }),
      indicator_ids: [i.id],
    })
  }
  prioritized(indicators, 'success')
    .slice(0, 3)
    .forEach((i) =>
      args.push({
        title: tx(lang, 'ind.stabilizing', { label: i.label }),
        direction: 'success',
        reasoning: tx(lang, 'ind.success_reasoning', { label: i.label, value: i.value, evidence: i.evidence }),
        indicator_ids: [i.id],
      }),
    )
  let measures: string[] = []
  for (const i of risks) {
    const key = MEASURES[i.id] ?? MEASURES[i.group]
    if (key && !measures.includes(tx(lang, key))) measures.push(tx(lang, key))
  }
  const financial = risks.filter((i) => i.priority === 'financial')
  let recommendation: string
  if (escalationTriggers(indicators, combos, lang).length) {
    const strongFin = financial.filter((i) => i.strength === 'strong')
    recommendation =
      combos.some((c) => c.id === 'dependency_decline') || strongFin.length >= 3 ? tx(lang, 'rec.phase_out') : tx(lang, 'rec.reevaluate')
  } else {
    recommendation = tx(lang, 'rec.observe')
    measures = measures.slice(0, 2)
  }
  const top =
    risks
      .slice(0, 3)
      .map((i) => i.label)
      .join(', ') || tx(lang, 'summary.none')
  if (!measures.length) measures = [tx(lang, 'measure.next_quarter')]
  return {
    summary: tx(lang, 'summary', { n_risk: risks.length, n_fin: financial.length, n_combo: combos.length, top }),
    arguments: args,
    recommendation,
    measures: measures.slice(0, 5),
  }
}

export function ruleDecision(indicators: Indicator[], combos: Combination[], registerStatus: Light, lang: Lang): Decision {
  const triggers = escalationTriggers(indicators, combos, lang)
  let justification: string
  if (triggers.length) {
    justification = tx(lang, 'decision.escalate', { triggers: triggers.slice(0, 4).join('; ') })
    if (registerStatus === 'red') justification += tx(lang, 'decision.register_red')
  } else {
    justification = tx(lang, 'decision.no_escalation')
  }
  return { escalate: triggers.length > 0, confidence: 'medium', justification }
}

// --- Prompts for the Claude agents (same instructions as the server's LLM agents) -------

const SYSTEM_ARGUMENT =
  "You are the AI agent 'Decision Maker' of an early-warning system for financially critical suppliers in " +
  'automotive purchasing. You receive structured risk and success indicators (with values, thresholds and ' +
  'sources) and combinations from the cross-referencing. Relativize and weigh the indicators against each ' +
  'other, prioritize financial over quality signals and build a traceable chain of argumentation for the ' +
  'responsible buyer: every argument must rest on specific indicator_ids. Also consider stabilizing success ' +
  'indicators. Do not invent figures; use only the values provided. Do not assign points or a score. Write ' +
  'factually. Give an action-oriented recommendation (e.g. careful re-evaluation, examine a phase-out, monitor) ' +
  'and 2–5 concrete measures.'

const SYSTEM_DECISION =
  "You are the AI agent 'Decision Maker'. Based on the chain of argumentation, decide whether the case is " +
  'escalated to the responsible buyer and the affected plant contacts (Escalation? yes/no). Escalate when the ' +
  'arguments point to a relevant financial risk that requires the buyer to act. Quality anomalies without ' +
  'financial signals are no reason to escalate. Justify the decision with the decisive arguments and do not ' +
  'assign a score.'

function formatIndicators(indicators: Indicator[], lang: Lang) {
  return [...prioritized(indicators, 'risk'), ...prioritized(indicators, 'success')]
    .map(
      (i) =>
        `- ${i.id} [${i.group}, ${i.type}, ${i.strength ? tx(lang, `strength.${i.strength}`) : ''}, priority ${i.priority}]: ${i.label} = ${i.value} (${i.source}; ${i.evidence})`,
    )
    .join('\n')
}

export function argumentationPrompt(
  supplier: { name: string; commodity: string; register_status: Light },
  indicators: Indicator[],
  combos: Combination[],
  lang: Lang,
) {
  return `${SYSTEM_ARGUMENT}

${tx(lang, 'language')}

Supplier: ${supplier.name} (${supplier.commodity}), internal risk register: ${LIGHT_NAMES[lang][supplier.register_status]}.

Indicators (prioritized):
${formatIndicators(indicators, lang) || '(none)'}

Combinations:
${combos.map((c) => `- ${c.title}: ${c.description} (${c.indicator_ids.join(', ')})`).join('\n') || '(none)'}

${JSON_ONLY}
{"summary": string, "arguments": [{"title": string, "direction": "risk" | "success", "reasoning": string, "indicator_ids": [string]}], "recommendation": string, "measures": [string]}`
}

export function decisionPrompt(supplier: { name: string; register_status: Light }, argumentation: Argumentation, lang: Lang) {
  return `${SYSTEM_DECISION}

${tx(lang, 'language')}

Supplier: ${supplier.name}. Internal risk register: ${LIGHT_NAMES[lang][supplier.register_status]}.
Summary: ${argumentation.summary}
Arguments:
${argumentation.arguments.map((a) => `- (${a.direction}) ${a.title}: ${a.reasoning}`).join('\n')}
Recommendation: ${argumentation.recommendation}

${JSON_ONLY}
{"escalate": boolean, "confidence": "low" | "medium" | "high", "justification": string}`
}

export function validArgumentation(v: unknown): v is Argumentation {
  const a = v as Argumentation
  return (
    !!a &&
    typeof a.summary === 'string' &&
    Array.isArray(a.arguments) &&
    a.arguments.every((x) => x && typeof x.title === 'string' && typeof x.reasoning === 'string') &&
    typeof a.recommendation === 'string' &&
    Array.isArray(a.measures)
  )
}

export function validDecision(v: unknown): Decision | null {
  const d = v as Decision
  if (!d || typeof d.escalate !== 'boolean' || typeof d.justification !== 'string') return null
  return {
    escalate: d.escalate,
    confidence: ['low', 'medium', 'high'].includes(d.confidence) ? d.confidence : 'medium',
    justification: d.justification,
  }
}
