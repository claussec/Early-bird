import type { Light } from './types'

// Status palette (fixed, never reused for data series). Always paired with icon + label.
export const STATUS: Record<Light, { color: string; label: string }> = {
  green: { color: '#0ca30c', label: 'Grün' },
  yellow: { color: '#fab219', label: 'Gelb' },
  red: { color: '#d03b3b', label: 'Rot' },
}

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
