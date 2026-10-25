/**
 * Decision Module (Figure 4) and the Internal Data agent's "Risk?" check (Figure 2) –
 * TypeScript port of backend/app/modules/decision_module.py and internal_module.risk_check
 * for the artifact variant. Keep both in sync.
 *
 * Following the paper there is no numeric score: the result is the argumentation and the
 * decisions "Risk?" and "Escalation?".
 */
import type { Combination, ExternalDoc, Indicator, Kpi, Light, Report } from '../types'

const FINANCIAL_GROUPS = ['Rating', 'Umsatz', 'Abhängigkeit', 'Planung']
const PRIORITY: Record<Indicator['priority'], number> = { finanziell: 0, extern: 1, operativ: 2 }
export const LIGHT_DE: Record<Light, string> = { green: 'Grün', yellow: 'Gelb', red: 'Rot' }
const STRENGTH_DE = { strong: 'deutlich', weak: 'schwach' }
const EXTERNAL_MAX_AGE_YEARS = 2

export type RiskCheck = { risk: boolean; reasoning: string }
export type Argumentation = Report['argumentation']
export type Decision = Report['decision']

// --- AI Agent "Internal Data": Risk? ---------------------------------------------------

export function ruleRiskCheck(kpis: Kpi[]): RiskCheck {
  if (!kpis.length) return { risk: false, reasoning: 'Keine internen Kennzahlen vorhanden – Neubewertung im nächsten Quartal.' }
  const flagged = kpis.filter((k) => k.status !== 'ok')
  if (!flagged.length)
    return { risk: false, reasoning: 'Alle Kennzahlen liegen innerhalb ihrer Schwellen – Neubewertung im nächsten Quartal.' }
  const listed = flagged
    .slice(0, 5)
    .map((k) => `${k.label} ${k.value} ${k.unit} (Schwelle: ${k.threshold})`)
    .join('; ')
  return { risk: true, reasoning: `${flagged.length} Kennzahl(en) über ihrer Schwelle: ${listed}.` }
}

export function riskPrompt(supplier: { name: string; commodity: string }, kpis: Kpi[]) {
  return `Du bist der AI Agent "Internal Data" eines Frühwarnsystems für finanziell kritische Lieferanten im Automotive-Einkauf. Du erhältst die aus internen Systemen berechneten Kennzahlen eines Lieferanten mit Formel, Schwelle und Quelle. Entscheide, ob Hinweise auf ein finanzielles Risiko vorliegen (risk = true), sodass der Lieferant im Decision Module vertieft analysiert wird, oder ob er erst im nächsten Quartal erneut bewertet wird (risk = false). Begründe kurz und sachlich auf Deutsch mit den konkreten Kennzahlen. Erfinde keine Werte und vergib keinen Score.

Lieferant: ${supplier.name} (${supplier.commodity}).

Kennzahlen:
${kpis.map((k) => `- ${k.label}: ${k.value} ${k.unit} – ${k.formula} (Schwelle: ${k.threshold}; Quelle: ${k.source})`).join('\n')}

Antworte nur mit JSON in genau dieser Form:
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

export function mapIndicators(kpis: Kpi[], external: ExternalDoc[], asOf: string): Indicator[] {
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
      priority: FINANCIAL_GROUPS.includes(k.group) ? 'finanziell' : 'operativ',
      value: `${k.value} ${k.unit}`,
      source: k.source,
      evidence: `${k.formula} (Schwelle: ${k.threshold})`,
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
      note = ` Meldung ist ${age} Jahre alt und wird daher schwächer gewichtet.`
    }
    indicators.push({
      id: `ext_${i}`,
      label: doc.title,
      group: 'Extern',
      category: doc.category,
      type: doc.signal,
      strength,
      severity: doc.severity,
      priority: 'extern',
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
  // Web signals with at least a clear warning (severity 2 of 3).
  const severeExt = extRisk.filter((i) => (i.severity ?? 1) >= 2)
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

// --- Step 3: Argumentation ------------------------------------------------------------

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

/**
 * Transparent escalation rule without an LLM: at least one combination from the
 * cross-referencing, or a financial (or financially relevant external) risk indicator clearly
 * above its threshold. Quality indicators alone never escalate.
 */
export function escalationTriggers(indicators: Indicator[], combos: Combination[]): string[] {
  const triggers = combos.map((c) => `Kombination „${c.title}“`)
  for (const i of prioritized(indicators, 'risk')) {
    if (i.strength === 'strong' && (i.priority === 'finanziell' || i.priority === 'extern')) {
      triggers.push(i.priority === 'finanziell' ? `${i.label} (${i.value})` : `Web-Meldung: ${i.label}`)
    }
  }
  return triggers
}

export function templateArgumentation(indicators: Indicator[], combos: Combination[]): Argumentation {
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
      reasoning: `${i.label}: ${i.value}, Risikoindikator (${STRENGTH_DE[i.strength ?? 'weak']}). ${i.evidence} (Quelle: ${i.source}).`,
      indicator_ids: [i.id],
    })
  }
  prioritized(indicators, 'success')
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
  const financial = risks.filter((i) => i.priority === 'finanziell')
  let recommendation: string
  if (escalationTriggers(indicators, combos).length) {
    recommendation =
      combos.some((c) => c.id === 'dependency_decline') || financial.filter((i) => i.strength === 'strong').length >= 3
        ? 'Sorgfältige Neubewertung des Lieferanten durch den Einkäufer; Phase-out bzw. Dual-Sourcing prüfen und das zentrale Risikomanagement einbinden.'
        : 'Sorgfältige Neubewertung des Lieferanten: Lieferantengespräch führen und aktuelle Finanzunterlagen anfordern.'
  } else {
    recommendation = 'Auffälligkeiten beobachten und im nächsten Quartal erneut bewerten.'
    measures = measures.slice(0, 2)
  }
  if (!measures.length) measures = ['Entwicklung im nächsten Quartal erneut bewerten']
  const top =
    risks
      .slice(0, 3)
      .map((i) => i.label)
      .join(', ') || 'keine'
  return {
    summary: `${risks.length} Risikoindikator(en), davon ${financial.length} finanziell, und ${combos.length} kritische Kombination(en). Wichtigste Treiber: ${top}.`,
    arguments: args,
    recommendation,
    measures: measures.slice(0, 5),
  }
}

export function ruleDecision(indicators: Indicator[], combos: Combination[], registerStatus: Light): Decision {
  const triggers = escalationTriggers(indicators, combos)
  let justification: string
  if (triggers.length) {
    justification = `Eskalation, ausschlaggebend: ${triggers.slice(0, 4).join('; ')}.`
    if (registerStatus === 'red') justification += ' Der Lieferant ist im internen Risikoregister bereits als Risikolieferant geführt.'
  } else {
    justification =
      'Keine Eskalation: Kein finanzieller Indikator liegt deutlich über seiner Schwelle und das Cross-Referencing hat keine kritische Kombination ergeben.'
  }
  return { escalate: triggers.length > 0, confidence: 'medium', justification }
}

// --- Prompts for the Claude agents (same instructions as the server's LLM agents) -------

function formatIndicators(indicators: Indicator[]) {
  return [...prioritized(indicators, 'risk'), ...prioritized(indicators, 'success')]
    .map(
      (i) =>
        `- ${i.id} [${i.group}, ${i.type}, ${i.strength ? STRENGTH_DE[i.strength] : ''}, Priorität ${i.priority}]: ${i.label} = ${i.value} (Quelle: ${i.source}; ${i.evidence})`,
    )
    .join('\n')
}

export function argumentationPrompt(
  supplier: { name: string; commodity: string; register_status: Light },
  indicators: Indicator[],
  combos: Combination[],
) {
  return `Du bist der AI Agent "Decision Maker" eines Frühwarnsystems für finanziell kritische Lieferanten im Automotive-Einkauf. Du erhältst strukturierte Risiko- und Erfolgsindikatoren (mit Werten, Schwellen und Quellen) sowie Kombinationen aus dem Cross-Referencing. Relativiere und gewichte die Indikatoren gegeneinander, priorisiere Finanzsignale vor Qualitätssignalen und erzeuge eine nachvollziehbare Argumentationskette für den verantwortlichen Einkäufer: Jedes Argument muss sich auf konkrete indicator_ids stützen. Berücksichtige auch stabilisierende Erfolgsindikatoren. Erfinde keine Zahlen; verwende nur die gelieferten Werte. Vergib keine Punkte und keinen Score. Schreibe sachlich auf Deutsch. Gib eine handlungsorientierte Empfehlung (z. B. sorgfältige Neubewertung, Phase-out prüfen, beobachten) und 2–5 konkrete Maßnahmen.

Lieferant: ${supplier.name} (${supplier.commodity}), internes Risikoregister: ${LIGHT_DE[supplier.register_status]}.

Indikatoren (priorisiert):
${formatIndicators(indicators) || '(keine)'}

Kombinationen:
${combos.map((c) => `- ${c.title}: ${c.description} (${c.indicator_ids.join(', ')})`).join('\n') || '(keine)'}

Antworte nur mit JSON in genau dieser Form:
{"summary": string, "arguments": [{"title": string, "direction": "risk" | "success", "reasoning": string, "indicator_ids": [string]}], "recommendation": string, "measures": [string]}`
}

export function decisionPrompt(supplier: { name: string; register_status: Light }, argumentation: Argumentation) {
  return `Du bist der AI Agent "Decision Maker". Entscheide auf Basis der Argumentationskette, ob der Fall an den verantwortlichen Einkäufer eskaliert wird (Escalation? ja/nein). Eskaliere, wenn die Argumente auf ein relevantes finanzielles Risiko hindeuten, das Handeln des Einkäufers erfordert. Reine Qualitätsauffälligkeiten ohne finanzielle Signale sind kein Grund für eine Eskalation. Begründe die Entscheidung mit den ausschlaggebenden Argumenten und vergib keinen Score.

Lieferant: ${supplier.name}. Internes Risikoregister: ${LIGHT_DE[supplier.register_status]}.
Zusammenfassung: ${argumentation.summary}
Argumente:
${argumentation.arguments.map((a) => `- (${a.direction}) ${a.title}: ${a.reasoning}`).join('\n')}
Empfehlung: ${argumentation.recommendation}

Antworte nur mit JSON in genau dieser Form:
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
