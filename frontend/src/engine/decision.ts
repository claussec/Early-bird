/**
 * Decision Module (Figure 4) – TypeScript port of backend/app/modules/decision_module.py
 * for the artifact variant. Keep both in sync.
 */
import type { Combination, ExternalDoc, Indicator, Kpi, Light, Report } from '../types'

export const GROUP_WEIGHTS: Record<string, number> = {
  Rating: 1.0,
  Umsatz: 0.9,
  Abhängigkeit: 0.9,
  Planung: 0.7,
  Extern: 0.6,
  Qualität: 0.4,
}
const KPI_WEIGHT_OVERRIDES: Record<string, number> = { rating_gap: 0.5, revenue_cagr: 0.6 }
const STATUS_SEVERITY: Record<string, number> = { critical: 1.0, warn: 0.5 }
const COMBINATION_BONUS = 0.75
const SCORE_SCALE = 3.0
export const LIGHTS: Light[] = ['green', 'yellow', 'red']
export const LIGHT_DE: Record<Light, string> = { green: 'Grün', yellow: 'Gelb', red: 'Rot' }

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
const fmt = (v: number, d = 2) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })

export const lightFor = (score: number): Light => (score >= 60 ? 'red' : score >= 35 ? 'yellow' : 'green')

// --- Step 1: Mapping indicators -------------------------------------------------------

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

export function mapIndicators(kpis: Kpi[], external: ExternalDoc[], asOf: string): Indicator[] {
  const indicators: Indicator[] = kpis.map((k) => {
    const weight = KPI_WEIGHT_OVERRIDES[k.id] ?? GROUP_WEIGHTS[k.group]
    let type: Indicator['type'] = 'neutral'
    let severity = 0
    if (k.status in STATUS_SEVERITY) {
      type = 'risk'
      severity = STATUS_SEVERITY[k.status]
    } else if (isSuccess(k)) {
      type = 'success'
      severity = 0.5
    }
    return {
      id: k.id,
      label: k.label,
      group: k.group,
      type,
      severity,
      weight,
      points: round(weight * severity, 2),
      value: `${k.value} ${k.unit}`,
      source: k.source,
      evidence: k.formula,
    }
  })
  const refYear = asOf ? Number(asOf.slice(0, 4)) : new Date().getFullYear()
  external.forEach((doc, i) => {
    if (doc.signal === 'neutral') return
    const age = doc.date ? Math.max(0, refYear - Number(doc.date.slice(0, 4))) : 1
    const recency = Math.max(0.25, 1 - 0.25 * age)
    const severity = doc.severity / 3
    indicators.push({
      id: `ext_${i}`,
      label: doc.title,
      group: 'Extern',
      category: doc.category,
      type: doc.signal,
      severity: round(severity, 2),
      weight: round(GROUP_WEIGHTS.Extern * recency, 2),
      points: round(GROUP_WEIGHTS.Extern * recency * severity, 2),
      value: doc.category,
      source: doc.source || 'Web',
      evidence: doc.rationale,
      date: doc.date,
      url: doc.url,
    })
  })
  return indicators
}

// --- Step 2: Cross-referencing --------------------------------------------------------

export function crossReference(indicators: Indicator[]): Combination[] {
  const byId = Object.fromEntries(indicators.map((i) => [i.id, i]))
  const risk = (id: string) => byId[id]?.type === 'risk'
  const extRisk = indicators.filter((i) => i.group === 'Extern' && i.type === 'risk')
  const finRisk = indicators.filter((i) => (i.group === 'Rating' || i.group === 'Umsatz') && i.type === 'risk')
  const combos: Combination[] = []
  if (risk('customer_share') && (risk('revenue_forecast') || risk('plan_change'))) {
    combos.push({
      id: 'dependency_decline',
      title: 'Abhängigkeitsfalle',
      description:
        'Hoher Customer-Share trifft auf rückläufiges Volumen: Der Umsatzrückgang beim Hauptkunden schlägt nahezu ungedämpft auf den Gesamtumsatz des Lieferanten durch.',
      indicator_ids: ['customer_share', 'revenue_forecast', 'plan_change'].filter(risk),
    })
  }
  if ((risk('pd_trend') || risk('pd_latest')) && risk('plan_volatility')) {
    combos.push({
      id: 'rating_planning',
      title: 'Rating-Verschlechterung bei Planungsunsicherheit',
      description:
        'Steigende Ausfallwahrscheinlichkeit bei gleichzeitig volatiler Volumenplanung: Der Lieferant kann Kapazitäten und Liquidität schlecht planen.',
      indicator_ids: ['pd_latest', 'pd_trend', 'plan_volatility'].filter(risk),
    })
  }
  if (risk('rating_gap') && risk('pd_trend')) {
    combos.push({
      id: 'rating_lag',
      title: 'Verzögertes externes Rating',
      description:
        'Das externe Rating wurde selten aktualisiert, zeigt aber einen deutlichen Sprung. Die tatsächliche Verschlechterung dürfte früher eingesetzt haben, als das Rating signalisiert.',
      indicator_ids: ['rating_gap', 'pd_trend'],
    })
  }
  if (extRisk.length && finRisk.length) {
    combos.push({
      id: 'external_confirms',
      title: 'Externe Signale bestätigen interne Befunde',
      description: 'Web-Meldungen deuten in dieselbe Richtung wie die internen Finanzkennzahlen.',
      indicator_ids: [...extRisk.slice(0, 3), ...finRisk.slice(0, 2)].map((i) => i.id),
    })
  }
  const severeExt = extRisk.filter((i) => i.severity >= 0.66)
  if (severeExt.length >= 2 && !finRisk.length) {
    combos.push({
      id: 'divergence',
      title: 'Divergenz: Rating unauffällig, Web-Signale kritisch',
      description:
        'Das externe Rating und die internen Finanzkennzahlen sind noch unauffällig, mehrere Web-Meldungen deuten jedoch auf eine Verschlechterung. Typischer Fall, den ein reines Rating-Monitoring zu spät erkennt.',
      indicator_ids: severeExt.slice(0, 3).map((i) => i.id),
    })
  }
  return combos
}

export function score(indicators: Indicator[], combos: Combination[]): Report['scoring'] {
  const riskPts = indicators.filter((i) => i.type === 'risk').reduce((a, i) => a + i.points, 0)
  const successPts = indicators.filter((i) => i.type === 'success').reduce((a, i) => a + i.points, 0)
  const comboPts = COMBINATION_BONUS * combos.length
  const total = Math.max(0, riskPts + comboPts - 0.5 * successPts)
  const value = Math.round(100 * (1 - Math.exp(-total / SCORE_SCALE)))
  return {
    score: value,
    traffic_light: lightFor(value),
    risk_points: round(riskPts, 2),
    success_points: round(successPts, 2),
    combination_points: round(comboPts, 2),
    formula: `Score = 100 · (1 − e^(−(${fmt(riskPts)} + ${fmt(comboPts)} − 0,5 · ${fmt(successPts)}) / ${fmt(SCORE_SCALE, 1)}))`,
  }
}

// --- Step 3: Argumentation ------------------------------------------------------------

export type Argumentation = Report['argumentation']
export type Decision = Report['decision']

const MEASURES: Record<string, string> = {
  customer_share: 'Abhängigkeit reduzieren: Volumenplanung und Mengenzusagen mit dem Lieferanten abstimmen',
  pd_latest: 'Aktuelle Bilanz, BWA und Liquiditätsplanung beim Lieferanten anfordern',
  pd_trend: 'Aktuelle Bilanz, BWA und Liquiditätsplanung beim Lieferanten anfordern',
  plan_volatility: 'Planungssicherheit erhöhen: verbindliche Forecasts und Rahmenmengen vereinbaren',
  revenue_forecast: 'Second Source qualifizieren bzw. Dual-Sourcing vorbereiten',
  plan_change: 'Auswirkung der Volumenreduktion mit dem Lieferanten besprechen',
  Extern: 'Hintergrund der Web-Meldungen im Lieferantengespräch klären',
  ppm: 'Quality-Audit beim Lieferanten einplanen',
  otd: 'Liefertreue im Lieferantengespräch adressieren',
}

export function templateArgumentation(indicators: Indicator[], combos: Combination[], light: Light): Argumentation {
  const args: Argumentation['arguments'] = []
  const covered = new Set<string>()
  combos.forEach((c) => {
    args.push({ title: c.title, direction: 'risk', reasoning: c.description, indicator_ids: c.indicator_ids })
    c.indicator_ids.forEach((id) => covered.add(id))
  })
  const risks = indicators.filter((i) => i.type === 'risk').sort((a, b) => b.points - a.points)
  for (const i of risks) {
    if (covered.has(i.id) || args.length >= 6) continue
    args.push({
      title: i.label,
      direction: 'risk',
      reasoning: `${i.label}: ${i.value}. ${i.evidence} (Quelle: ${i.source}).`,
      indicator_ids: [i.id],
    })
  }
  indicators
    .filter((i) => i.type === 'success')
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .forEach((i) =>
      args.push({
        title: `Stabilisierend: ${i.label}`,
        direction: 'success',
        reasoning: `${i.label}: ${i.value}. ${i.evidence}.`,
        indicator_ids: [i.id],
      }),
    )
  let measures: string[] = []
  for (const i of risks) {
    const m = MEASURES[i.id] ?? MEASURES[i.group]
    if (m && !measures.includes(m)) measures.push(m)
  }
  const top =
    risks
      .slice(0, 3)
      .map((i) => i.label)
      .join(', ') || 'keine'
  let recommendation: string
  if (light === 'red') {
    recommendation =
      'Eskalation an den verantwortlichen Einkäufer: Lieferant sorgfältig neu bewerten, Phase-out bzw. Dual-Sourcing prüfen und das zentrale Risikomanagement einbinden.'
  } else if (light === 'yellow') {
    recommendation =
      'Sorgfältige Neubewertung des Lieferanten: Lieferantengespräch führen, Finanzunterlagen anfordern und Entwicklung im nächsten Quartal eng beobachten.'
  } else {
    recommendation = 'Keine Maßnahme erforderlich – reguläres quartalsweises Monitoring fortsetzen.'
    measures = measures.slice(0, 1)
  }
  if (!measures.length) measures = ['Reguläres Monitoring im nächsten Quartal']
  return {
    summary: `${risks.length} Risikoindikator(en) und ${combos.length} kritische Kombination(en) identifiziert. Wichtigste Treiber: ${top}.`,
    arguments: args,
    recommendation,
    measures: measures.slice(0, 5),
  }
}

export function ruleDecision(scoring: Report['scoring'], registerStatus: Light, combos: Combination[]): Decision {
  const light = scoring.traffic_light
  const worse = LIGHTS.indexOf(light) > LIGHTS.indexOf(registerStatus)
  const reasons = [`Score ${scoring.score}/100 → ${LIGHT_DE[light]}`]
  if (worse) reasons.push(`Verschlechterung gegenüber Risikoregister (${LIGHT_DE[registerStatus]} → ${LIGHT_DE[light]})`)
  if (combos.length) reasons.push(`${combos.length} kritische Indikator-Kombination(en)`)
  return {
    traffic_light: light,
    escalate: light === 'red' || worse,
    confidence: Math.abs(scoring.score - 47) > 20 ? 'high' : 'medium',
    justification: reasons.join('; ') + '.',
  }
}

// --- Prompts for the Claude agents (same instructions as the server's LLM agents) -------

export function formatIndicators(indicators: Indicator[]) {
  return indicators
    .filter((i) => i.type !== 'neutral')
    .map((i) => `- ${i.id} [${i.group}, ${i.type}, Punkte ${i.points}]: ${i.label} = ${i.value} (Quelle: ${i.source}; ${i.evidence})`)
    .join('\n')
}

export function argumentationPrompt(
  supplier: { name: string; commodity: string; register_status: Light },
  indicators: Indicator[],
  combos: Combination[],
  scoring: Report['scoring'],
) {
  return `Du bist der AI Agent "Decision Maker" eines Frühwarnsystems für finanziell kritische Lieferanten im Automotive-Einkauf. Du erhältst strukturierte, bereits berechnete Indikatoren (mit Formeln und Quellen) und Kombinationen. Erzeuge eine nachvollziehbare Argumentationskette für den verantwortlichen Einkäufer: Jedes Argument muss sich auf konkrete indicator_ids stützen. Priorisiere Finanzsignale vor Qualitätssignalen. Erfinde keine Zahlen; verwende nur die gelieferten Werte. Schreibe sachlich auf Deutsch. Gib eine handlungsorientierte Empfehlung und 2–5 konkrete Maßnahmen.

Lieferant: ${supplier.name} (${supplier.commodity}), internes Risikoregister: ${LIGHT_DE[supplier.register_status]}.
Regelbasierter Score: ${scoring.score}/100 (${LIGHT_DE[scoring.traffic_light]}).

Indikatoren:
${formatIndicators(indicators) || '(keine auffälligen Indikatoren)'}

Kombinationen:
${combos.map((c) => `- ${c.title}: ${c.description} (${c.indicator_ids.join(', ')})`).join('\n') || '(keine)'}

Antworte nur mit JSON in genau dieser Form:
{"summary": string, "arguments": [{"title": string, "direction": "risk" | "success", "reasoning": string, "indicator_ids": [string]}], "recommendation": string, "measures": [string]}`
}

export function decisionPrompt(
  supplier: { name: string; register_status: Light },
  scoring: Report['scoring'],
  argumentation: Argumentation,
) {
  return `Du bist der AI Agent "Decision Maker". Entscheide über die Ampel (green/yellow/red) und ob an den Einkäufer eskaliert wird. Der regelbasierte Score ist der Ausgangspunkt; du darfst höchstens um eine Stufe abweichen und musst jede Abweichung begründen. Eskaliere, wenn die Ampel rot ist oder sich die Einstufung gegenüber dem internen Risikoregister verschlechtert.

Lieferant: ${supplier.name}. Internes Risikoregister: ${supplier.register_status}.
Regelbasierter Score: ${scoring.score}/100 → ${scoring.traffic_light}.
Zusammenfassung: ${argumentation.summary}
Argumente:
${argumentation.arguments.map((a) => `- (${a.direction}) ${a.title}: ${a.reasoning}`).join('\n')}

Antworte nur mit JSON in genau dieser Form:
{"traffic_light": "green" | "yellow" | "red", "escalate": boolean, "confidence": "low" | "medium" | "high", "justification": string}`
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

/** Applies the guardrail: at most one level away from the rule-based light; escalation rules enforced. */
export function guardDecision(v: unknown, baseline: Decision, registerStatus: Light): Decision | null {
  const d = v as Decision
  if (!d || !LIGHTS.includes(d.traffic_light) || typeof d.justification !== 'string') return null
  const out: Decision = {
    traffic_light: d.traffic_light,
    escalate: !!d.escalate,
    confidence: ['low', 'medium', 'high'].includes(d.confidence) ? d.confidence : 'medium',
    justification: d.justification,
  }
  if (Math.abs(LIGHTS.indexOf(out.traffic_light) - LIGHTS.indexOf(baseline.traffic_light)) > 1) {
    out.traffic_light = 'yellow'
    out.justification += ' (Begrenzt auf eine Stufe Abweichung vom regelbasierten Score.)'
  }
  if (out.traffic_light === 'red' || LIGHTS.indexOf(out.traffic_light) > LIGHTS.indexOf(registerStatus)) out.escalate = true
  return out
}
