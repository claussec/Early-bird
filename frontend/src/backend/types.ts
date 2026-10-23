import type { ParsedSignals } from '../engine/external'
import type {
  AgentMode,
  Automode,
  Channel,
  ExternalDoc,
  Meta,
  Notification,
  StreamEvent,
  Supplier,
  SupplierDetail,
  SupplierInput,
  Target,
} from '../types'

/**
 * Everything the UI needs from a backend. `server` talks to the FastAPI app,
 * `artifact` runs the agents in the browser on claude.ai. Optional groups exist
 * only in one of the two; the UI shows a feature only when its group is present.
 */
export interface Backend {
  target: Target
  meta(): Promise<Meta>
  suppliers(): Promise<Supplier[]>
  supplier(id: string): Promise<SupplierDetail>
  notifications(): Promise<Notification[]>
  createSupplier(input: SupplierInput): Promise<Supplier>
  deleteSupplier(id: string): Promise<void>
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
    set(changes: Partial<Pick<Automode, 'enabled' | 'interval_minutes' | 'channels'>>): Promise<Automode>
    run(): Promise<{ started: boolean }>
  }

  /** Artifact only: web research through a Claude chat (prompt out, answer back in). */
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

  /** Artifact only: storage state and demo data. */
  storage?: {
    persistent(): boolean
    hasDemoData(): boolean
    removeDemoData(): Promise<void>
  }
}
