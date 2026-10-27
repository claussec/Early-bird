import type { ParsedSignals } from '../engine/external'
import type {
  AgentMode,
  Automode,
  Channel,
  ExternalDoc,
  Lang,
  Meta,
  Notification,
  Plant,
  PlantInput,
  StreamEvent,
  Supplier,
  SupplierDetail,
  SupplierInput,
  Target,
} from '../types'

/**
 * Everything the UI needs from a backend. `server` talks to the FastAPI app, `artifact`
 * runs the agents in the browser on claude.ai, `demo` is the standalone page (in memory,
 * rule-based). Optional groups exist only in some of them; the UI shows a feature only when
 * its group is present.
 */
export interface Backend {
  target: Target
  /** Language of the texts the agents generate from now on. */
  setLang(lang: Lang): void
  meta(): Promise<Meta>
  suppliers(): Promise<Supplier[]>
  supplier(id: string): Promise<SupplierDetail>
  notifications(): Promise<Notification[]>
  createSupplier(input: SupplierInput): Promise<Supplier>
  /** Updates master data and plant links (and figures, if given) and re-evaluates. */
  updateSupplier(id: string, input: SupplierInput): Promise<Supplier>
  deleteSupplier(id: string): Promise<void>
  plants(): Promise<Plant[]>
  createPlant(input: PlantInput): Promise<Plant>
  updatePlant(id: string, input: PlantInput): Promise<Plant>
  deletePlant(id: string): Promise<void>
  /** Runs the agent pipeline for one supplier and reports each step. */
  analyze(id: string, onEvent: (e: StreamEvent) => void): Promise<void>
  /** Evaluates every supplier. */
  cycle(onEvent: (e: StreamEvent) => void): Promise<void>
  /** Live updates (artifact: other viewers' changes). Returns the unsubscribe. */
  subscribe?(onChange: () => void): () => void

  /** Server only: auto mode with Outlook/Teams notifications. */
  automode?: {
    channels(): Promise<Channel[]>
    get(): Promise<Automode>
    set(changes: Partial<Pick<Automode, 'enabled' | 'interval_minutes' | 'channels' | 'lang'>>): Promise<Automode>
    run(): Promise<{ started: boolean }>
  }

  /** Artifact and demo: web research through a Claude chat (prompt out, answer back in). */
  webResearch?: {
    /** Stores the supplier's web signals and re-evaluates it (`agents`: current agent mode, `rules`: no Claude calls). */
    save(supplierId: string, signals: ExternalDoc[], reevaluate: 'agents' | 'rules'): Promise<void>
    /** Structures free text with Claude when the pasted answer holds no usable JSON. */
    structure(text: string, suppliers: Supplier[]): Promise<ParsedSignals[]>
    canStructure(): boolean
  }

  /** Artifact only: run the agents with Claude or rule-based. */
  agents?: {
    mode(): AgentMode
    setMode(mode: AgentMode): void
    available(): boolean
  }

  /** Artifact and demo: storage state and demo data. */
  storage?: {
    persistent(): boolean
    hasDemoData(): boolean
    removeDemoData(): Promise<void>
  }
}
