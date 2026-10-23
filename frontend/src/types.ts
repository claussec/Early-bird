export type Light = 'green' | 'yellow' | 'red'

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
  is_case_study: boolean
  score?: number
  traffic_light?: Light
  escalate?: boolean
  assessed_at?: string
  as_of?: string
  customer_share?: number
  pd?: number
  revenue_forecast?: number | null
  purchase_volume?: number
  revenue?: number
  external_risks?: number
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
  severity: number
  weight: number
  points: number
  value: string
  source: string
  evidence: string
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
  scoring: {
    score: number
    traffic_light: Light
    risk_points: number
    success_points: number
    combination_points: number
    formula: string
  }
  argumentation: {
    summary: string
    arguments: { title: string; direction: 'risk' | 'success'; reasoning: string; indicator_ids: string[] }[]
    recommendation: string
    measures: string[]
  }
  decision: { traffic_light: Light; escalate: boolean; confidence: string; justification: string }
  notification: Notification | null
}

export interface Backtest {
  description: string
  actual: { year: number; revenue: number; customer_share: number }[]
  actual_pd: { date: string; pd: number }[]
  paper_table: string[][]
  rows: { year: number; forecast: number; actual: number; ape: number; actual_share: number }[]
  mape: number | null
}

export interface SupplierDetail {
  supplier: Supplier
  report: Report | null
  history: { created_at: string; score: number; traffic_light: Light; llm: string }[]
  backtest: Backtest | null
}

export interface Notification {
  id?: number
  supplier_id: string
  created_at: string
  recipient: string
  subject: string
  body: string
}

export interface Meta {
  llm: string
  provider: string
  crawler_enabled: boolean
  commodities: string[]
  countries: string[]
  steps: [string, string, string][]
}

export interface StepState {
  status: 'pending' | 'running' | 'done'
  summary: string
}

export interface Filters {
  query: string
  lights: Light[]
  commodities: string[]
  countries: string[]
  escalatedOnly: boolean
  highDependency: boolean
  minPd: number
}

export interface StreamEvent {
  type: string
  step?: string
  status?: StepState['status']
  summary?: string
  supplier_id?: string
  name?: string
  traffic_light?: Light
  score?: number
}
