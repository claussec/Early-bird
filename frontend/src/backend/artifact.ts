/**
 * Artifact variant: runs the agent pipeline in the browser on claude.ai.
 *
 * - Storage: the artifact's shared `db` (collections `suppliers`, `results`, `notifications`).
 *   Without it (signed out, preview) everything stays in memory for this visit.
 * - AI: Claude through the viewer's claude.ai account (`sample`), with the same prompts as
 *   the server's LLM agents; without it the agents fall back to their rules.
 * See docs/ARTIFACT_VARIANT.md for the differences to the server app.
 */
import { normalizeSignals, structurePrompt, type ParsedSignals } from '../engine/external'
import { STEPS, runPipeline, type AskJson } from '../engine/pipeline'
import type { InternalData } from '../engine/internal'
import type {
  AgentMode,
  ExternalDoc,
  Light,
  Meta,
  Notification,
  Report,
  StreamEvent,
  Supplier,
  SupplierDetail,
  SupplierInput,
} from '../types'
import type { Backend } from './types'

// --- Minimal typings of the claude.ai runtime used here (contract 0.2.89) ----------------

interface DocSnap {
  id: string
  exists: boolean
  data(): Record<string, unknown> | undefined
}
interface QuerySnap {
  docs: DocSnap[]
}
interface DocRef {
  set(data: Record<string, unknown>): Promise<void>
  delete(): Promise<void>
}
interface Query {
  orderBy(field: string, dir?: 'asc' | 'desc'): Query
  limit(n: number): Query
  where(field: string, op: string, value: unknown): Query
  get(): Promise<QuerySnap>
  onSnapshot(next: (s: QuerySnap) => void, error?: (e: { code: string }) => void): () => void
}
interface Collection extends Query {
  doc(id?: string): DocRef
}
interface DB {
  collection(path: string): Collection
}
interface Sample {
  json(input: string, options?: Record<string, unknown>): Promise<unknown>
}
declare global {
  interface Window {
    claude?: { use(name: string): Promise<unknown> }
  }
}

interface SupplierDoc {
  master: Supplier
  internal: InternalData
  external: ExternalDoc[]
}
interface ResultDoc {
  report: Report
  history: SupplierDetail['history']
}

const AI_LABEL = 'Claude (über dein claude.ai-Konto)'
const MODE_KEY = 'early-bird.agent-mode'
const PACE_MS = 350
const HISTORY = 20

// --- State ------------------------------------------------------------------------------

const suppliers = new Map<string, SupplierDoc>()
const results = new Map<string, ResultDoc>()
let notifications: Notification[] = []
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

let db: DB | null = null
let sample: Sample | null = null
let aiBlocked = false

function readMode(): AgentMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'rules' ? 'rules' : 'claude'
  } catch {
    return 'claude'
  }
}
let mode: AgentMode = readMode()

const ready: Promise<void> = (async () => {
  const runtime = window.claude
  if (!runtime) return
  const [d, s] = await Promise.all([
    runtime.use('db').catch(() => null) as Promise<DB | null>,
    runtime.use('sample').catch(() => null) as Promise<Sample | null>,
  ])
  sample = s
  if (!d) return
  db = d
  // One subscription per collection; every viewer's change arrives live.
  await new Promise<void>((resolve) => {
    let pending = 3
    const subscribe = (query: Query, apply: (snap: QuerySnap) => void) => {
      let first = true
      const settle = () => {
        if (first) {
          first = false
          if (--pending === 0) resolve()
        } else notify()
      }
      query.onSnapshot(
        (snap) => {
          apply(snap)
          settle()
        },
        () => settle(),
      )
    }
    subscribe(d.collection('suppliers'), (snap) => {
      suppliers.clear()
      snap.docs.forEach((doc) => doc.exists && suppliers.set(doc.id, doc.data() as unknown as SupplierDoc))
    })
    subscribe(d.collection('results'), (snap) => {
      results.clear()
      snap.docs.forEach((doc) => doc.exists && results.set(doc.id, doc.data() as unknown as ResultDoc))
    })
    subscribe(d.collection('notifications').orderBy('created_at', 'desc').limit(50), (snap) => {
      notifications = snap.docs.filter((doc) => doc.exists).map((doc) => doc.data() as unknown as Notification)
    })
  })
})()

// --- Persistence (db, or memory for this visit) ----------------------------------------

async function writeSupplier(id: string, doc: SupplierDoc) {
  if (db)
    await db
      .collection('suppliers')
      .doc(id)
      .set(doc as unknown as Record<string, unknown>)
  else {
    suppliers.set(id, doc)
    notify()
  }
}

async function writeResult(id: string, doc: ResultDoc) {
  if (db)
    await db
      .collection('results')
      .doc(id)
      .set(doc as unknown as Record<string, unknown>)
  else {
    results.set(id, doc)
    notify()
  }
}

async function addNotification(n: Notification) {
  if (db)
    await db
      .collection('notifications')
      .doc()
      .set(n as unknown as Record<string, unknown>)
  else {
    notifications = [n, ...notifications].slice(0, 50)
    notify()
  }
}

async function removeSupplier(id: string) {
  if (db) {
    await db.collection('suppliers').doc(id).delete()
    await db.collection('results').doc(id).delete()
    const own = await db.collection('notifications').where('supplier_id', '==', id).get()
    for (const doc of own.docs) await db.collection('notifications').doc(doc.id).delete()
  } else {
    suppliers.delete(id)
    results.delete(id)
    notifications = notifications.filter((n) => n.supplier_id !== id)
    notify()
  }
}

// --- Agents ----------------------------------------------------------------------------

function askJson(): AskJson | null {
  if (mode !== 'claude' || !sample || aiBlocked) return null
  const s = sample
  return async (prompt) => {
    try {
      return await s.json(prompt, { modelTier: 'default' })
    } catch (e) {
      const code = (e as { code?: string }).code
      // Permanent refusals: stop asking for the rest of this visit.
      if (code && ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) {
        aiBlocked = true
      }
      throw e
    }
  }
}

/** Rule-based assessment for suppliers that have no stored result yet (nothing is written). */
const provisional = new Map<string, { key: string; report: Report }>()
async function reportFor(id: string): Promise<Report | null> {
  const stored = results.get(id)?.report
  // Results stored by the first artifact version (with a numeric score) are recomputed.
  if (stored?.risk_check) return stored
  const doc = suppliers.get(id)
  if (!doc) return null
  const key = JSON.stringify(doc)
  const cached = provisional.get(id)
  if (cached?.key === key) return cached.report
  const report = await runPipeline(
    { supplier: doc.master, internal: doc.internal, external: doc.external ?? [] },
    { ai: null, aiLabel: AI_LABEL },
  )
  provisional.set(id, { key, report })
  return report
}

async function evaluate(id: string, opts: { ai: AskJson | null; onEvent?: (e: StreamEvent) => void; pace?: number }) {
  const doc = suppliers.get(id)
  if (!doc) throw new Error('Lieferant nicht gefunden')
  const report = await runPipeline(
    { supplier: doc.master, internal: doc.internal, external: doc.external ?? [] },
    { ai: opts.ai, aiLabel: AI_LABEL, onEvent: opts.onEvent, pace: opts.pace },
  )
  const prev = (results.get(id)?.history ?? []).filter((h) => h.status)
  const entry = { created_at: report.created_at, status: report.status, llm: report.llm }
  await writeResult(id, { report, history: [...prev, entry].slice(-HISTORY) })
  if (report.decision.escalate) {
    const s = doc.master
    await addNotification({
      supplier_id: id,
      created_at: report.created_at,
      recipient: s.buyer.name ? `${s.buyer.name}${s.buyer.email ? ` <${s.buyer.email}>` : ''}` : 'Einkauf',
      subject: `[Frühwarnung] ${s.name} (${s.number})`,
      body: `${report.argumentation.summary}\n\nEmpfehlung: ${report.argumentation.recommendation}`,
      channel: 'inapp',
      status: 'sent',
      error: '',
    })
  }
  return report
}

// --- Mapping to the shapes the UI already uses (as backend/app/main.py `_summary`) --------

function summary(master: Supplier, report: Report | null): Supplier {
  if (!report) return { ...master }
  const kpi = Object.fromEntries(report.kpis.map((k) => [k.id, k]))
  const series = report.series
  return {
    ...master,
    status: report.status,
    escalate: report.decision.escalate,
    risk_indicators: report.indicators.filter((i) => i.type === 'risk').length,
    recommendation: report.argumentation.recommendation,
    assessed_at: report.created_at,
    as_of: report.as_of,
    customer_share: kpi.customer_share?.value ?? null,
    pd: kpi.pd_latest?.value ?? null,
    revenue_forecast: kpi.revenue_forecast?.value ?? null,
    purchase_volume: series.purchase.length ? series.purchase[series.purchase.length - 1] : null,
    revenue: series.revenue.length ? series.revenue[series.revenue.length - 1] : null,
    external_risks: report.external.filter((d) => d.signal === 'risk').length,
    missing_sources: report.missing_sources ?? [],
    headline: report.argumentation.summary,
  }
}

/** Form input → Internal Module dataset (as backend/app/schemas.py `SupplierFigures.to_internal`). */
function toInternal(f: NonNullable<SupplierInput['figures']>): InternalData {
  const years = [...f.years].sort((a, b) => a.year - b.year)
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const data: InternalData = {
    as_of: '',
    revenue: Object.fromEntries(years.map((y) => [String(y.year), y.revenue])),
    purchase: Object.fromEntries(years.map((y) => [String(y.year), y.purchase])),
    plan_snapshots: [],
    pd_history: [],
    quality: {},
  }
  if (years.length && f.plan_next_year !== null) {
    data.plan_snapshots = [
      {
        date: `${today.getFullYear()}-Q${Math.floor(today.getMonth() / 3) + 1}`,
        volumes: { [String(years[years.length - 1].year + 1)]: f.plan_next_year },
      },
    ]
  }
  if (f.pd_previous !== null) {
    const d = new Date(today)
    d.setFullYear(d.getFullYear() - 1)
    data.pd_history!.push({ date: iso(d), pd: f.pd_previous })
  }
  if (f.pd_current !== null) data.pd_history!.push({ date: iso(today), pd: f.pd_current })
  const last = years.length ? years[years.length - 1].year : today.getFullYear()
  if (f.ppm_current !== null || f.otd !== null) {
    data.quality![String(last)] = { ppm: f.ppm_current, otd: f.otd !== null ? f.otd / 100 : null }
  }
  if (f.ppm_previous !== null) data.quality![String(last - 1)] = { ppm: f.ppm_previous, otd: null }
  return data
}

function validate(input: SupplierInput) {
  if (!input.number.trim()) throw new Error('Bitte eine Lieferantennummer angeben.')
  if (input.name.trim().length < 2) throw new Error('Bitte einen Namen angeben.')
  if (input.buyer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.buyer_email)) throw new Error('Die E-Mail-Adresse ist ungültig.')
  const n = input.number.trim().toLowerCase()
  if ([...suppliers.values()].some((s) => s.master.number.toLowerCase() === n)) {
    throw new Error(`Lieferantennummer ${input.number.trim()} existiert bereits`)
  }
}

function friendly(e: unknown): Error {
  const code = (e as { code?: string })?.code
  if (code === 'invalid_argument')
    return new Error('Du hast für dieses Artefakt nur Leserechte. Änderungen kann nur speichern, wer Bearbeitungsrechte hat.')
  if (code === 'quota_exceeded') return new Error('Der Speicher des Artefakts ist voll. Bitte nicht mehr benötigte Lieferanten löschen.')
  if (code === 'resource_exhausted' || code === 'unavailable')
    return new Error('Der Speicher ist gerade ausgelastet. Bitte gleich noch einmal versuchen.')
  return e instanceof Error ? e : new Error((e as { message?: string })?.message ?? 'Unbekannter Fehler')
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw friendly(e)
  }
}

// --- Backend ---------------------------------------------------------------------------

export const artifactBackend: Backend = {
  target: 'artifact',

  async meta(): Promise<Meta> {
    await ready
    const masters = [...suppliers.values()].map((s) => s.master)
    const ai = mode === 'claude' && !!sample && !aiBlocked
    return {
      llm: ai ? AI_LABEL : 'Regelbasiert (ohne LLM)',
      provider: ai ? 'claude.ai' : 'rules',
      crawler_enabled: false,
      commodities: [...new Set(masters.map((m) => m.commodity))].sort(),
      countries: [...new Set(masters.map((m) => m.country).filter(Boolean))].sort(),
      steps: STEPS,
    }
  },

  async suppliers() {
    await ready
    const ids = [...suppliers.keys()].sort()
    return Promise.all(ids.map(async (id) => summary(suppliers.get(id)!.master, await reportFor(id))))
  },

  async supplier(id): Promise<SupplierDetail> {
    await ready
    const doc = suppliers.get(id)
    if (!doc) throw new Error('Lieferant nicht gefunden')
    const report = await reportFor(id)
    return { supplier: summary(doc.master, report), report, history: (results.get(id)?.history ?? []).filter((h) => h.status) }
  },

  async notifications() {
    await ready
    return notifications
  },

  createSupplier: (input) =>
    guarded(async () => {
      await ready
      validate(input)
      const id = `S${Date.now().toString(36).toUpperCase()}`
      const master: Supplier = {
        id,
        number: input.number.trim(),
        name: input.name.trim(),
        city: input.city.trim(),
        country: input.country.trim().toUpperCase(),
        website: input.website.trim(),
        commodity: input.commodity.trim() || 'Sonstige',
        buyer: { name: input.buyer_name.trim(), email: input.buyer_email ?? '' },
        register_status: input.register_status as Light,
        source: 'manual',
      }
      const doc: SupplierDoc = { master, internal: input.figures ? toInternal(input.figures) : {}, external: [] }
      await writeSupplier(id, doc)
      suppliers.set(id, doc)
      const report = await evaluate(id, { ai: askJson() })
      return summary(master, report)
    }),

  deleteSupplier: (id) => guarded(() => removeSupplier(id)),

  analyze: (id, onEvent) =>
    guarded(async () => {
      await ready
      const ai = askJson()
      await evaluate(id, { ai, onEvent, pace: ai ? 0 : PACE_MS })
    }),

  cycle: (onEvent) =>
    guarded(async () => {
      await ready
      // Bulk runs stay rule-based so one click does not spend dozens of Claude calls.
      for (const id of [...suppliers.keys()].sort()) {
        const doc = suppliers.get(id)
        if (!doc) continue
        onEvent({ type: 'supplier', supplier_id: id, name: doc.master.name })
        const report = await evaluate(id, { ai: null })
        onEvent({ type: 'supplier_done', supplier_id: id, status: report.status })
      }
      onEvent({ type: 'cycle_done' })
    }),

  subscribe(onChange) {
    listeners.add(onChange)
    return () => listeners.delete(onChange)
  },

  webResearch: {
    save: (supplierId, signals, reevaluate) =>
      guarded(async () => {
        const doc = suppliers.get(supplierId)
        if (!doc) throw new Error('Lieferant nicht gefunden')
        const next = { ...doc, external: signals }
        await writeSupplier(supplierId, next)
        suppliers.set(supplierId, next)
        await evaluate(supplierId, { ai: reevaluate === 'agents' ? askJson() : null })
      }),
    async structure(text, list): Promise<ParsedSignals[]> {
      if (!sample || aiBlocked) throw new Error('Claude ist in dieser Ansicht nicht verfügbar.')
      try {
        return normalizeSignals(await sample.json(structurePrompt(text, list), { modelTier: 'default' }))
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'not_granted') {
          aiBlocked = true
          throw new Error('Du hast Claude für dieses Artefakt nicht erlaubt.')
        }
        if (code === 'rate_limited') throw new Error('Gerade zu viele Anfragen an Claude. Bitte später noch einmal versuchen.')
        throw new Error('Claude konnte den Text nicht auswerten. Bitte die Antwort mit dem JSON-Block einfügen.')
      }
    },
    canStructure: () => !!sample && !aiBlocked,
  },

  agents: {
    mode: () => mode,
    setMode(m) {
      mode = m
      try {
        localStorage.setItem(MODE_KEY, m)
      } catch {
        /* per-viewer convenience only */
      }
      notify()
    },
    available: () => !!sample && !aiBlocked,
  },

  storage: {
    persistent: () => !!db,
    hasDemoData: () => [...suppliers.values()].some((s) => s.master.source === 'demo'),
    removeDemoData: () =>
      guarded(async () => {
        for (const [id, s] of [...suppliers.entries()]) if (s.master.source === 'demo') await removeSupplier(id)
      }),
  },
}
