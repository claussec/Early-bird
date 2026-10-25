export type Light = 'green' | 'yellow' | 'red'

/** Result of the two decisions in Figure 2: "Risk?" (Internal Data agent) and "Escalation?" (Decision Maker). */
export type RiskStatus = 'none' | 'risk' | 'escalated'

export interface Buyer {
  name: string
  email: string
}

export interface Supplier {
  id: string
  number: string
  name: string
  city: string
  country: string
  website: string
  commodity: string
  buyer: Buyer
  register_status: Light
  source: string
  status?: RiskStatus
  escalate?: boolean
  risk_indicators?: number
  recommendation?: string
  assessed_at?: string
  as_of?: string
  customer_share?: number | null
  pd?: number | null
  revenue_forecast?: number | null
  purchase_volume?: number | null
  revenue?: number | null
  external_risks?: number
  missing_sources?: string[]
  headline?: string
}

export interface Kpi {
  id: string
  label: string
  group: string
  value: number
  unit: string
  status: 'ok' | 'warn' | 'critical'
  formula: string
  threshold: string
  source: string
}

export interface Indicator {
  id: string
  label: string
  group: string
  type: 'risk' | 'success' | 'neutral'
  /** Risk indicators: "strong" above the critical threshold, "weak" above the warning threshold. */
  strength: 'strong' | 'weak' | null
  /** Financial signals are prioritized over external and operational ones. */
  priority: 'finanziell' | 'extern' | 'operativ'
  value: string
  source: string
  evidence: string
  severity?: number
  date?: string
  url?: string
  category?: string
}

export interface Combination {
  id: string
  title: string
  description: string
  indicator_ids: string[]
}

export interface ExternalDoc {
  date: string
  title: string
  source: string
  url: string
  category: string
  signal: 'risk' | 'success' | 'neutral'
  severity: 1 | 2 | 3
  rationale: string
}

export interface Report {
  supplier_id: string
  created_at: string
  llm: string
  as_of: string
  status: RiskStatus
  risk_check: { risk: boolean; reasoning: string; method: string }
  kpis: Kpi[]
  forecast: { year: number; revenue: number; purchase: number; customer_share: number }[]
  series: {
    years: number[]
    revenue: number[]
    purchase: number[]
    customer_share: number[]
    pd_history: { date: string; pd: number }[]
    plan_revisions: { date: string; volume: number }[]
  }
  external: ExternalDoc[]
  external_origin: string
  indicators: Indicator[]
  combinations: Combination[]
  argumentation: {
    summary: string
    arguments: { title: string; direction: 'risk' | 'success'; reasoning: string; indicator_ids: string[] }[]
    recommendation: string
    measures: string[]
  }
  decision: { escalate: boolean; confidence: string; justification: string }
  missing_sources: string[]
  deliveries: Notification[]
}

export interface SupplierDetail {
  supplier: Supplier
  report: Report | null
  history: { created_at: string; status: RiskStatus; llm: string }[]
}

export interface Notification {
  id?: number
  supplier_id: string
  created_at: string
  recipient: string
  subject: string
  body: string
  channel: string
  status: 'sent' | 'failed'
  error: string
}

export interface Channel {
  id: string
  name: string
  configured: boolean
}

export interface Automode {
  enabled: boolean
  interval_minutes: number
  channels: string[]
  last_run: string | null
  next_run: string | null
  running: boolean
  last_result: { suppliers: number; escalations: number; sent: number; failed: number; source_notes: string[] } | null
}

export interface SupplierInput {
  number: string
  name: string
  commodity: string
  city: string
  country: string
  website: string
  buyer_name: string
  buyer_email: string | null
  register_status: Light
  figures: {
    years: { year: number; revenue: number; purchase: number }[]
    plan_next_year: number | null
    pd_current: number | null
    pd_previous: number | null
    ppm_current: number | null
    ppm_previous: number | null
    otd: number | null
  } | null
}

export interface Meta {
  llm: string
  provider: string
  crawler_enabled: boolean
  commodities: string[]
  countries: string[]
  steps: [string, string, string][]
}

/** Which build is running: the server app (REST API) or the claude.ai artifact (agents in the browser). */
export type Target = 'server' | 'artifact'

export type AgentMode = 'claude' | 'rules'

export interface StepState {
  status: 'pending' | 'running' | 'done' | 'skipped'
  summary: string
}

export interface Filters {
  query: string
  statuses: RiskStatus[]
  commodities: string[]
  countries: string[]
  escalatedOnly: boolean
  highDependency: boolean
  minPd: number
}

export interface StreamEvent {
  type: string
  step?: string
  /** Step events: the step's state; `supplier_done`: the supplier's RiskStatus. */
  status?: StepState['status'] | RiskStatus
  summary?: string
  supplier_id?: string
  name?: string
}
