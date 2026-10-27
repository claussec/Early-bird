/**
 * External Module for the artifact variant. The artifact cannot reach other websites, so
 * web research runs in a regular Claude chat: the page builds a research prompt, the user
 * pastes Claude's answer back, and the page turns it into classified web signals.
 * (Server variant: backend/app/modules/external_module.py crawls live.)
 */
import type { ExternalDoc, Supplier } from '../types'
import { tx, type Lang } from './texts'

export const CATEGORIES = ['Finanzen', 'Personal', 'Management', 'Markt', 'Produktion', 'ESG', 'Presse'] as const

const RISK_TERMS = [
  'insolvenz',
  'insolvency',
  'kurzarbeit',
  'stellenabbau',
  'streicht',
  'restrukturierung',
  'restructuring',
  'verlust',
  'loss',
  'zahlungsverzug',
  'verzögerten zahlungen',
  'schließt',
  'schließung',
  'kündigt rahmenvertrag',
  'rückruf',
  'recall',
  'verlagerung',
  'tritt zurück',
  'verlässt',
  'gerüchte',
  'banken',
  'einbruch',
  'layoff',
]
const SUCCESS_TERMS = [
  'investiert',
  'investition',
  'gewinnzone',
  'gewinnt',
  'preis',
  'erweitert',
  'expansion',
  'auftrag',
  'wachstum',
  'growth',
  'rekord',
  'finanzinvestor',
  'award',
]
const SEVERE_TERMS = ['insolvenz', 'restrukturierung', 'zahlungsverzug', 'verzögerten zahlungen', 'banken']

/** Rule-based fallback, identical to the server's keyword classifier. */
export function keywordClassify(doc: Partial<ExternalDoc> & { title: string; hint?: string }, lang: Lang): ExternalDoc {
  const text = `${doc.title} ${doc.rationale ?? ''}`.toLowerCase()
  const risk = RISK_TERMS.filter((t) => text.includes(t))
  const success = SUCCESS_TERMS.filter((t) => text.includes(t))
  const category = (CATEGORIES as readonly string[]).includes(doc.category ?? doc.hint ?? '') ? (doc.category ?? doc.hint)! : 'Presse'
  const base = { date: doc.date ?? '', title: doc.title, source: doc.source ?? '', url: doc.url ?? '', category }
  if (risk.length && risk.length >= success.length) {
    const severe = SEVERE_TERMS.some((t) => text.includes(t))
    return { ...base, signal: 'risk', severity: severe ? 3 : 2, rationale: tx(lang, 'ext.risk_terms', { terms: risk.join(', ') }) }
  }
  if (success.length) return { ...base, signal: 'success', severity: 1, rationale: tx(lang, 'ext.success_terms', { terms: success.join(', ') }) }
  return { ...base, signal: 'neutral', severity: 1, rationale: tx(lang, 'ext.no_signal') }
}

const SIGNAL_SPEC: Record<Lang, string> = {
  de: `{"date": "JJJJ-MM-TT", "title": "Schlagzeile", "source": "Medium oder Website", "url": "https://…", "category": "${CATEGORIES.join(' | ')}", "signal": "risk | success | neutral", "severity": 1 | 2 | 3, "rationale": "1–2 Sätze, warum das für die finanzielle Stabilität relevant ist"}`,
  en: `{"date": "YYYY-MM-DD", "title": "Headline", "source": "Outlet or website", "url": "https://…", "category": "${CATEGORIES.join(' | ')}", "signal": "risk | success | neutral", "severity": 1 | 2 | 3, "rationale": "1–2 sentences on why this matters for financial stability"}`,
}

const RESEARCH_TASK: Record<Lang, string> = {
  de: `Recherchiere im Web nach aktuellen Meldungen der letzten 24 Monate, die etwas über die finanzielle Stabilität aussagen.
Achte besonders auf: Insolvenz oder Insolvenzgerüchte, Restrukturierung, Bankengespräche, Kurzarbeit, Stellenabbau, Werksschließungen, Verlagerungen, Verluste, verspätete Zahlungen, Wechsel in Geschäftsführung oder Finanzleitung, Verlust großer Kunden, Rückrufe, aber auch positive Signale wie Investitionen, neue Aufträge, Wachstum, neue Investoren.
Nutze Unternehmenswebsite, Pressemitteilungen, Fach- und Lokalpresse, Handelsregister-/Bundesanzeiger-Meldungen und Arbeitgeberbewertungen.

Regeln:
- Nur Meldungen, die sich eindeutig auf genau dieses Unternehmen beziehen (Namensgleichheit prüfen, Ort/Branche abgleichen).
- Nichts erfinden. Wenn du nichts findest, gib eine leere Liste zurück.
- signal: "risk" = Hinweis auf finanzielle Instabilität, "success" = Hinweis auf Stabilität, sonst "neutral".
- severity: 3 = unmittelbar insolvenzrelevant, 2 = deutliches Warnsignal, 1 = schwaches Signal.
- category: immer einer der deutschen Schlüssel oben.`,
  en: `Search the web for recent reports from the last 24 months that say something about the company's financial stability.
Look especially for: insolvency or insolvency rumours, restructuring, talks with banks, short-time work, job cuts, plant closures, relocations, losses, late payments, changes in management or finance leadership, loss of major customers, recalls, but also positive signals such as investments, new orders, growth, new investors.
Use the company website, press releases, trade and local press, commercial register announcements and employer reviews.

Rules:
- Only reports that clearly refer to exactly this company (check for namesakes, compare location/industry).
- Do not invent anything. If you find nothing, return an empty list.
- signal: "risk" = sign of financial instability, "success" = sign of stability, otherwise "neutral".
- severity: 3 = immediately relevant to insolvency, 2 = clear warning sign, 1 = weak signal.
- category: always one of the German keys above (Finanzen = finance, Personal = workforce, Markt = market, Produktion = production, Presse = press).`,
}

const INTRO: Record<Lang, string> = {
  de: 'Du unterstützt das Lieferanten-Risikomanagement im Automotive-Einkauf.',
  en: 'You support supplier risk management in automotive purchasing.',
}

function describe(s: Supplier, lang: Lang) {
  const L =
    lang === 'de'
      ? { number: 'Lieferantennummer', address: 'Adresse', website: 'Website', commodity: 'Warengruppe' }
      : { number: 'Supplier number', address: 'Address', website: 'Website', commodity: 'Commodity' }
  const address = [s.street, [s.zip, s.city].filter(Boolean).join(' '), s.country].filter(Boolean).join(', ')
  return [
    `Name: ${s.name}`,
    `${L.number}: ${s.number}`,
    address ? `${L.address}: ${address}` : '',
    s.website ? `${L.website}: ${s.website}` : '',
    `${L.commodity}: ${s.commodity}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function researchPrompt(s: Supplier, lang: Lang) {
  const check = lang === 'de' ? 'Prüfe den folgenden Lieferanten:' : 'Check the following supplier:'
  const end = lang === 'de' ? 'Gib am Ende einen einzigen JSON-Codeblock aus, genau in dieser Form:' : 'Finish with a single JSON code block in exactly this form:'
  return `${INTRO[lang]} ${check}

${describe(s, lang)}

${RESEARCH_TASK[lang]}

${end}
\`\`\`json
{"supplier_number": "${s.number}", "signals": [${SIGNAL_SPEC[lang]}]}
\`\`\``
}

export function batchResearchPrompt(suppliers: Supplier[], lang: Lang) {
  const check =
    lang === 'de'
      ? `Prüfe jeden der folgenden ${suppliers.length} Lieferanten einzeln:`
      : `Check each of the following ${suppliers.length} suppliers individually:`
  const end =
    lang === 'de'
      ? 'Gib am Ende einen einzigen JSON-Codeblock aus, mit einem Eintrag pro Lieferant (auch wenn nichts gefunden wurde), genau in dieser Form:'
      : 'Finish with a single JSON code block with one entry per supplier (even if nothing was found), in exactly this form:'
  return `${INTRO[lang]} ${check}

${suppliers.map((s, i) => `${i + 1}.\n${describe(s, lang)}`).join('\n\n')}

${RESEARCH_TASK[lang]}

${end}
\`\`\`json
[{"supplier_number": "…", "signals": [${SIGNAL_SPEC[lang]}]}]
\`\`\``
}

/** Finds the JSON value in a pasted Claude answer: a ```json fence, else the outermost [...] or {...}. */
export function extractJson(text: string): unknown {
  const candidates: string[] = []
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1])
  const firstArr = text.indexOf('[')
  const firstObj = text.indexOf('{')
  const start = [firstArr, firstObj].filter((i) => i >= 0).sort((a, b) => a - b)[0]
  if (start !== undefined) candidates.push(text.slice(start, Math.max(text.lastIndexOf(']'), text.lastIndexOf('}')) + 1))
  for (const c of candidates.reverse()) {
    try {
      return JSON.parse(c.trim())
    } catch {
      /* try next candidate */
    }
  }
  return undefined
}

export interface ParsedSignals {
  supplier_number: string | null
  signals: ExternalDoc[]
}

function normalizeSignal(raw: Record<string, unknown>, lang: Lang): ExternalDoc | null {
  const title = String(raw.title ?? raw.titel ?? '').trim()
  if (!title) return null
  const signal = String(raw.signal ?? '').toLowerCase()
  const severity = Number(raw.severity ?? raw.schwere)
  const category = String(raw.category ?? raw.kategorie ?? '')
  const doc = {
    date: String(raw.date ?? raw.datum ?? '').slice(0, 10),
    title,
    source: String(raw.source ?? raw.quelle ?? ''),
    url: String(raw.url ?? ''),
    category: (CATEGORIES as readonly string[]).includes(category) ? category : 'Presse',
    rationale: String(raw.rationale ?? raw.begruendung ?? raw.begründung ?? ''),
  }
  if (!['risk', 'success', 'neutral'].includes(signal) || ![1, 2, 3].includes(severity)) {
    // Incomplete classification: fall back to the keyword classifier, keep Claude's rationale.
    const k = keywordClassify(doc, lang)
    return { ...k, rationale: doc.rationale || k.rationale }
  }
  return { ...doc, signal: signal as ExternalDoc['signal'], severity: severity as ExternalDoc['severity'] }
}

/** Accepts {signals:[…]}, [{supplier_number, signals}], or a bare list of signals. */
export function normalizeSignals(value: unknown, lang: Lang): ParsedSignals[] {
  const groups: ParsedSignals[] = []
  const asGroup = (v: Record<string, unknown>): ParsedSignals => ({
    supplier_number:
      v.supplier_number != null ? String(v.supplier_number) : v.lieferantennummer != null ? String(v.lieferantennummer) : null,
    signals: (Array.isArray(v.signals) ? v.signals : Array.isArray(v.signale) ? v.signale : [])
      .map((s: unknown) => (s && typeof s === 'object' ? normalizeSignal(s as Record<string, unknown>, lang) : null))
      .filter((s): s is ExternalDoc => s !== null),
  })
  if (Array.isArray(value)) {
    const objects = value.filter((v) => v && typeof v === 'object') as Record<string, unknown>[]
    if (objects.some((o) => 'signals' in o || 'signale' in o)) objects.forEach((o) => groups.push(asGroup(o)))
    else groups.push({ supplier_number: null, signals: objects.map((o) => normalizeSignal(o, lang)).filter((s): s is ExternalDoc => s !== null) })
  } else if (value && typeof value === 'object') {
    groups.push(asGroup(value as Record<string, unknown>))
  }
  return groups
}

export function structurePrompt(text: string, suppliers: Supplier[], lang: Lang) {
  return `The following text is web research on one or more suppliers. Extract every report that says something about financial stability. Do not invent anything; take over only what the text says. ${tx(lang, 'language')} (rationale)

Known suppliers: ${suppliers.map((s) => `${s.number} = ${s.name}`).join('; ')}

Answer only with a JSON array, one entry per supplier, in exactly this form:
[{"supplier_number": "…", "signals": [${SIGNAL_SPEC[lang]}]}]

Text:
"""
${text.slice(0, 60000)}
"""`
}

export const signalKey = (d: Pick<ExternalDoc, 'title' | 'url'>) => (d.url || d.title).trim().toLowerCase()
