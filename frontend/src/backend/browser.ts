/**
 * In-browser variants: the agent pipeline runs in the page.
 *
 * - `artifact` (claude.ai): storage in the artifact's shared `db` (collections `suppliers`,
 *   `plants`, `results`, `notifications`); AI through the viewer's claude.ai account (`sample`)
 *   with the same prompts as the server's LLM agents, otherwise the agents' rules. Without a
 *   `db` (signed out, preview) it behaves like the demo.
 * - `demo` (standalone page): the fictitious demo data in memory for this visit, rule-based.
 * See docs/ARTIFACT_VARIANT.md for the differences to the server app.
 */
import { keywordClassify, normalizeSignals, structurePrompt, type ParsedSignals } from '../engine/external'
import { loadGazetteer, locate } from '../engine/geo'
import type { InternalData } from '../engine/internal'
import { STEPS, runPipeline, type AskJson } from '../engine/pipeline'
import { tx } from '../engine/texts'
import type {
  AgentMode,
  ExternalDoc,
  Lang,
  Light,
  Meta,
  Notification,
  Plant,
  PlantInput,
  Report,
  StreamEvent,
  Supplier,
  SupplierDetail,
  SupplierInput,
} from '../types'
import seedData from './demo-seed.json'
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

/** Stored web documents: classified signals, or raw demo documents (`hint` = category). */
type StoredDoc = ExternalDoc | { date: string; title: string; source: string; url: string; hint: string }

interface SupplierDoc {
  master: Supplier
  internal: InternalData
  external: StoredDoc[]
}
interface ResultDoc {
  report: Report
  history: SupplierDetail['history']
}

const TARGET: 'artifact' | 'demo' = import.meta.env.VITE_TARGET === 'demo' ? 'demo' : 'artifact'
const MODE_KEY = 'early-bird.agent-mode'
const PACE_MS = 350
const HISTORY = 20

const ERRORS: Record<Lang, Record<string, string>> = {
  de: {
    not_found: 'Lieferant nicht gefunden',
    plant_not_found: 'Werk nicht gefunden',
    number: 'Bitte eine Lieferantennummer angeben.',
    name: 'Bitte einen Namen angeben.',
    plant_name: 'Bitte einen Werksnamen angeben.',
    email: 'Die E-Mail-Adresse ist ungültig: {email}',
    duplicate: 'Lieferantennummer {number} existiert bereits',
    read_only: 'Du hast für dieses Artefakt nur Leserechte. Änderungen kann nur speichern, wer Bearbeitungsrechte hat.',
    quota: 'Der Speicher des Artefakts ist voll. Bitte nicht mehr benötigte Lieferanten löschen.',
    busy: 'Der Speicher ist gerade ausgelastet. Bitte gleich noch einmal versuchen.',
    unknown: 'Unbekannter Fehler',
    no_claude: 'Claude ist in dieser Ansicht nicht verfügbar.',
    not_granted: 'Du hast Claude für dieses Artefakt nicht erlaubt.',
    rate_limited: 'Gerade zu viele Anfragen an Claude. Bitte später noch einmal versuchen.',
    unparsable: 'Claude konnte den Text nicht auswerten. Bitte die Antwort mit dem JSON-Block einfügen.',
  },
  en: {
    not_found: 'Supplier not found',
    plant_not_found: 'Plant not found',
    number: 'Please enter a supplier number.',
    name: 'Please enter a name.',
    plant_name: 'Please enter a plant name.',
    email: 'Invalid e-mail address: {email}',
    duplicate: 'Supplier number {number} already exists',
    read_only: 'You can only view this artifact. Changes can be saved by people with edit access.',
    quota: "The artifact's storage is full. Please delete suppliers you no longer need.",
    busy: 'Storage is busy right now. Please try again in a moment.',
    unknown: 'Unknown error',
    no_claude: 'Claude is not available in this view.',
    not_granted: 'You have not allowed Claude for this artifact.',
    rate_limited: 'Too many requests to Claude right now. Please try again later.',
    unparsable: "Claude could not evaluate the text. Please paste the answer including the JSON block.",
  },
}

// --- State ------------------------------------------------------------------------------

const suppliers = new Map<string, SupplierDoc>()
const plants = new Map<string, Plant>()
const results = new Map<string, ResultDoc>()
let notifications: Notification[] = []
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

let db: DB | null = null
let sample: Sample | null = null
let aiBlocked = false
let lang: Lang = 'de'

const err = (key: string, vars?: Record<string, unknown>) =>
  new Error(ERRORS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')))

function readMode(): AgentMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'rules' ? 'rules' : 'claude'
  } catch {
    return 'claude'
  }
}
let mode: AgentMode = TARGET === 'demo' ? 'rules' : readMode()

function seedMemory() {
  for (const p of seedData.plants as unknown as Plant[]) plants.set(p.id, p)
  for (const s of seedData.suppliers as unknown as SupplierDoc[]) suppliers.set(s.master.id, s)
}

const ready: Promise<void> = (async () => {
  const gazetteer = loadGazetteer().catch(() => undefined)
  const runtime = TARGET === 'artifact' ? window.claude : undefined
  if (!runtime) {
    seedMemory()
    await gazetteer
    return
  }
  const [d, s] = await Promise.all([
    runtime.use('db').catch(() => null) as Promise<DB | null>,
    runtime.use('sample').catch(() => null) as Promise<Sample | null>,
  ])
  sample = s
  if (!d) {
    seedMemory()
    await gazetteer
    return
  }
  db = d
  // One subscription per collection; every viewer's change arrives live.
  await new Promise<void>((resolve) => {
    let pending = 4
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
    subscribe(d.collection('plants'), (snap) => {
      plants.clear()
      snap.docs.forEach((doc) => doc.exists && plants.set(doc.id, doc.data() as unknown as Plant))
    })
    subscribe(d.collection('results'), (snap) => {
      results.clear()
      snap.docs.forEach((doc) => doc.exists && results.set(doc.id, doc.data() as unknown as ResultDoc))
    })
    subscribe(d.collection('notifications').orderBy('created_at', 'desc').limit(50), (snap) => {
      notifications = snap.docs.filter((doc) => doc.exists).map((doc) => doc.data() as unknown as Notification)
    })
  })
  await gazetteer
})()

// --- Persistence (db, or memory for this visit) ----------------------------------------

async function write(collection: 'suppliers' | 'plants' | 'results', id: string, value: object) {
  if (db)
    await db
      .collection(collection)
      .doc(id)
      .set(value as Record<string, unknown>)
  const map = { suppliers, plants, results }[collection] as Map<string, object>
  map.set(id, value)
  if (!db) notify()
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
  }
  suppliers.delete(id)
  results.delete(id)
  if (!db) {
    notifications = notifications.filter((n) => n.supplier_id !== id)
    notify()
  }
}

async function removePlant(id: string) {
  for (const [sid, s] of [...suppliers.entries()]) {
    const ids = s.master.plant_ids ?? []
    if (ids.includes(id)) await write('suppliers', sid, { ...s, master: { ...s.master, plant_ids: ids.filter((p) => p !== id) } })
  }
  if (db) await db.collection('plants').doc(id).delete()
  plants.delete(id)
  if (!db) notify()
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

const classified = (docs: StoredDoc[]): ExternalDoc[] => docs.map((d) => ('signal' in d && d.signal ? d : keywordClassify(d, lang)))

const pipelineInput = (doc: SupplierDoc) => ({
  supplier: doc.master,
  internal: doc.internal,
  external: classified(doc.external ?? []),
  plants: [...plants.values()],
})

/**
 * Stored result, or a rule-based assessment computed on the fly (nothing is written) when
 * there is none yet, when it predates the current result format, or when a rule-based result
 * is shown in another language – rules are deterministic, so the texts can be regenerated.
 */
const provisional = new Map<string, { key: string; report: Report }>()
async function reportFor(id: string): Promise<Report | null> {
  const stored = results.get(id)?.report
  const ruleBased = stored && !stored.llm.startsWith('Claude')
  if (stored?.risk_check && ((stored.lang ?? 'de') === lang || !ruleBased)) return stored
  const doc = suppliers.get(id)
  if (!doc) return null
  const key = JSON.stringify([doc, [...plants.values()], lang])
  const cached = provisional.get(id)
  if (cached?.key === key) return cached.report
  const report = await runPipeline(pipelineInput(doc), { ai: null, aiLabel: tx(lang, 'llm.claude'), lang })
  provisional.set(id, { key, report })
  return report
}

async function evaluate(id: string, opts: { ai: AskJson | null; onEvent?: (e: StreamEvent) => void; pace?: number }) {
  const doc = suppliers.get(id)
  if (!doc) throw err('not_found')
  const report = await runPipeline(pipelineInput(doc), {
    ai: opts.ai,
    aiLabel: tx(lang, 'llm.claude'),
    lang,
    onEvent: opts.onEvent,
    pace: opts.pace,
  })
  const prev = (results.get(id)?.history ?? []).filter((h) => h.status)
  const entry = { created_at: report.created_at, status: report.status, llm: report.llm }
  await write('results', id, { report, history: [...prev, entry].slice(-HISTORY) })
  for (const d of report.deliveries) await addNotification(d)
  return report
}

// --- Mapping to the shapes the UI uses (as backend/app/main.py `_summary`) ---------------

function withLocation<T extends Supplier | Plant>(entity: T): T {
  return entity.location ? entity : { ...entity, location: locate(entity) }
}

function summary(master: Supplier, report: Report | null): Supplier {
  const base = withLocation({ ...master, plant_ids: master.plant_ids ?? [] })
  if (!report) return base
  const kpi = Object.fromEntries(report.kpis.map((k) => [k.id, k]))
  const series = report.series
  return {
    ...base,
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

function plantSummary(p: Plant): Plant {
  return withLocation({ ...p, supplier_ids: [...suppliers.values()].filter((s) => s.master.plant_ids?.includes(p.id)).map((s) => s.master.id) })
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateSupplier(input: SupplierInput, selfId?: string) {
  if (!input.number.trim()) throw err('number')
  if (input.name.trim().length < 2) throw err('name')
  if (input.buyer_email && !EMAIL.test(input.buyer_email)) throw err('email', { email: input.buyer_email })
  const n = input.number.trim().toLowerCase()
  if ([...suppliers.values()].some((s) => s.master.id !== selfId && s.master.number.toLowerCase() === n)) {
    throw err('duplicate', { number: input.number.trim() })
  }
}

const address = (input: SupplierInput | PlantInput) => {
  const a = { street: input.street.trim(), zip: input.zip.trim(), city: input.city.trim(), country: input.country.trim().toUpperCase() }
  return { ...a, location: locate(a, input.lat, input.lon) }
}

function masterFrom(id: string, input: SupplierInput, source: string): Supplier {
  return {
    id,
    number: input.number.trim(),
    name: input.name.trim(),
    ...address(input),
    website: input.website.trim(),
    commodity: input.commodity.trim() || 'Sonstige',
    buyer: { name: input.buyer_name.trim(), email: input.buyer_email ?? '' },
    register_status: input.register_status as Light,
    source,
    plant_ids: input.plant_ids.filter((p) => plants.has(p)),
  }
}

function plantFrom(id: string, input: PlantInput): Plant {
  if (input.name.trim().length < 2) throw err('plant_name')
  const contacts = input.contacts
    .map((c) => ({ name: c.name.trim(), email: c.email.trim(), role: c.role.trim() }))
    .filter((c) => c.name || c.email)
  const bad = contacts.find((c) => c.email && !EMAIL.test(c.email))
  if (bad) throw err('email', { email: bad.email })
  return { id, name: input.name.trim(), ...address(input), contacts }
}

function friendly(e: unknown): Error {
  const code = (e as { code?: string })?.code
  if (code === 'invalid_argument') return err('read_only')
  if (code === 'quota_exceeded') return err('quota')
  if (code === 'resource_exhausted' || code === 'unavailable') return err('busy')
  return e instanceof Error ? e : new Error((e as { message?: string })?.message ?? ERRORS[lang].unknown)
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    await ready
    return await fn()
  } catch (e) {
    throw friendly(e)
  }
}

const newId = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase()}`

// --- Backend ---------------------------------------------------------------------------

export const browserBackend: Backend = {
  target: TARGET,

  setLang(l) {
    if (l === lang) return
    lang = l
    notify()
  },

  async meta(): Promise<Meta> {
    await ready
    const masters = [...suppliers.values()].map((s) => s.master)
    const ai = mode === 'claude' && !!sample && !aiBlocked
    return {
      llm: ai ? tx(lang, 'llm.claude') : tx(lang, 'llm.rules'),
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
    if (!doc) throw err('not_found')
    const report = await reportFor(id)
    return { supplier: summary(doc.master, report), report, history: (results.get(id)?.history ?? []).filter((h) => h.status) }
  },

  async notifications() {
    await ready
    return notifications
  },

  createSupplier: (input) =>
    guarded(async () => {
      validateSupplier(input)
      const id = newId('S')
      const master = masterFrom(id, input, 'manual')
      await write('suppliers', id, { master, internal: input.figures ? toInternal(input.figures) : {}, external: [] })
      return summary(master, await evaluate(id, { ai: askJson() }))
    }),

  updateSupplier: (id, input) =>
    guarded(async () => {
      const doc = suppliers.get(id)
      if (!doc) throw err('not_found')
      validateSupplier(input, id)
      const master = masterFrom(id, input, doc.master.source)
      await write('suppliers', id, { ...doc, master, internal: input.figures ? toInternal(input.figures) : doc.internal })
      return summary(master, await evaluate(id, { ai: askJson() }))
    }),

  deleteSupplier: (id) => guarded(() => removeSupplier(id)),

  async plants() {
    await ready
    return [...plants.values()].sort((a, b) => a.id.localeCompare(b.id)).map(plantSummary)
  },

  createPlant: (input) =>
    guarded(async () => {
      const plant = plantFrom(newId('P'), input)
      await write('plants', plant.id, plant)
      return plantSummary(plant)
    }),

  updatePlant: (id, input) =>
    guarded(async () => {
      if (!plants.has(id)) throw err('plant_not_found')
      const plant = plantFrom(id, input)
      await write('plants', id, plant)
      return plantSummary(plant)
    }),

  deletePlant: (id) => guarded(() => removePlant(id)),

  analyze: (id, onEvent) =>
    guarded(async () => {
      const ai = askJson()
      await evaluate(id, { ai, onEvent, pace: ai ? 0 : PACE_MS })
    }),

  cycle: (onEvent) =>
    guarded(async () => {
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
        if (!doc) throw err('not_found')
        await write('suppliers', supplierId, { ...doc, external: signals })
        await evaluate(supplierId, { ai: reevaluate === 'agents' ? askJson() : null })
      }),
    async structure(text, list): Promise<ParsedSignals[]> {
      if (!sample || aiBlocked) throw err('no_claude')
      try {
        return normalizeSignals(await sample.json(structurePrompt(text, list, lang), { modelTier: 'default' }), lang)
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'not_granted') {
          aiBlocked = true
          throw err('not_granted')
        }
        if (code === 'rate_limited') throw err('rate_limited')
        throw err('unparsable')
      }
    },
    canStructure: () => !!sample && !aiBlocked,
  },

  agents:
    TARGET === 'artifact'
      ? {
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
        }
      : undefined,

  storage: {
    persistent: () => !!db,
    hasDemoData: () => [...suppliers.values()].some((s) => s.master.source === 'demo'),
    removeDemoData: () =>
      guarded(async () => {
        for (const [id, s] of [...suppliers.entries()]) if (s.master.source === 'demo') await removeSupplier(id)
      }),
  },
}
