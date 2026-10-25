import type { Light, RiskStatus } from './types'

// Status palette (fixed, never reused for data series). Always paired with icon + label.
export const STATUS: Record<Light, { color: string; label: string }> = {
  green: { color: '#0ca30c', label: 'Grün' },
  yellow: { color: '#fab219', label: 'Gelb' },
  red: { color: '#d03b3b', label: 'Rot' },
}

/**
 * The two decisions of the paper (Risk?, Escalation?) as one state. Shown with the status
 * colors, always together with icon + label. Not a score.
 */
export const RISK: Record<RiskStatus, { light: Light; label: string; hint: string }> = {
  none: { light: 'green', label: 'Kein Risiko', hint: 'Risk? = nein – Neubewertung im nächsten Quartal' },
  risk: { light: 'yellow', label: 'Risiko erkannt', hint: 'Risk? = ja, Escalation? = nein' },
  escalated: { light: 'red', label: 'Eskaliert', hint: 'Escalation? = ja – Einkäufer benachrichtigt' },
}
export const RISK_ORDER: RiskStatus[] = ['escalated', 'risk', 'none']

// 3D scene variants of the status colors (brighter for emissive glow on a dark scene).
export const GLOW: Record<Light, string> = {
  green: '#2bd46a',
  yellow: '#ffc23d',
  red: '#ff4747',
}

// Categorical series (dark-mode steps of the validated reference palette).
export const SERIES = {
  actual: '#3987e5',
  forecast: '#d95926',
  third: '#199e70',
}

export const KPI_STATUS: Record<string, Light> = { ok: 'green', warn: 'yellow', critical: 'red' }

export const fmt = (v: number | undefined | null, digits = 1) =>
  v === undefined || v === null ? '–' : v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Value with unit, or a dash when the value is missing. */
export const fmtUnit = (v: number | undefined | null, unit: string, digits = 1) =>
  v === undefined || v === null ? '–' : `${fmt(v, digits)} ${unit}`

/** Joins the non-empty parts with a middle dot. */
export const joinDot = (...parts: (string | undefined | null)[]) => parts.filter(Boolean).join(' · ')
