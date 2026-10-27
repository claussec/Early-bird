import type { Light, RiskStatus } from './types'

// Status palette (fixed, never reused for data series). Always paired with icon + label
// (labels: i18n keys `light.*`).
export const STATUS: Record<Light, { color: string }> = {
  green: { color: '#0ca30c' },
  yellow: { color: '#fab219' },
  red: { color: '#d03b3b' },
}

/**
 * The two decisions of the paper (Risk?, Escalation?) as one state. Shown with the status
 * colors, always together with icon + label (i18n keys `risk.*`). Not a score.
 */
export const RISK: Record<RiskStatus, { light: Light }> = {
  none: { light: 'green' },
  risk: { light: 'yellow' },
  escalated: { light: 'red' },
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

let locale = 'de-DE'
/** Set by the language switch; numbers and dates follow the UI language. */
export const setLocale = (l: string) => {
  locale = l
}
export const getLocale = () => locale

export const fmt = (v: number | undefined | null, digits = 1) =>
  v === undefined || v === null ? '–' : v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const fmtDate = (iso: string | null | undefined, withTime = true) =>
  iso ? new Date(iso).toLocaleString(locale, withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }) : '–'

/** Value with unit, or a dash when the value is missing. */
export const fmtUnit = (v: number | undefined | null, unit: string, digits = 1) =>
  v === undefined || v === null ? '–' : `${fmt(v, digits)} ${unit}`

/** Joins the non-empty parts with a middle dot. */
export const joinDot = (...parts: (string | undefined | null)[]) => parts.filter(Boolean).join(' · ')
