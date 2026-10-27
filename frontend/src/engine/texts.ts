/**
 * Agent texts for the in-browser variants (artifact, standalone demo). The shared keys come
 * from backend/app/i18n.py via texts.gen.ts; BROWSER_TEXTS holds what only these variants say.
 */
import { TEXTS, type Lang } from './texts.gen'

export type { Lang }

const BROWSER_TEXTS: Record<Lang, Record<string, string>> = {
  de: {
    'ext.signals': '{n} Web-Signale hinterlegt',
    'ext.no_signals': 'Keine Web-Signale hinterlegt',
    'step.external.browser': '{origin}. {n} Risikosignal(e)',
    'channel.cockpit': 'Cockpit',
    'llm.claude': 'Claude (über dein claude.ai-Konto)',
    'mail.plain_recommendation': 'Empfehlung: {text}',
  },
  en: {
    'ext.signals': '{n} web signals on record',
    'ext.no_signals': 'No web signals on record',
    'step.external.browser': '{origin}. {n} risk signal(s)',
    'channel.cockpit': 'cockpit',
    'llm.claude': 'Claude (via your claude.ai account)',
    'mail.plain_recommendation': 'Recommendation: {text}',
  },
}

export const isLang = (v: unknown): v is Lang => v === 'de' || v === 'en'

/** Formats like Python's str.format for the specs used in i18n.py ({x}, {x:.2f}, {x:+.0f}). */
function format(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{(\w+)(?::([+]?)\.(\d+)f)?\}/g, (_, key: string, sign: string, digits: string) => {
    const v = vars[key]
    if (digits === undefined) return String(v)
    const n = Number(v)
    const s = n.toFixed(Number(digits))
    return sign && n >= 0 ? `+${s}` : s
  })
}

export function tx(lang: Lang, key: string, vars?: Record<string, unknown>): string {
  const text = BROWSER_TEXTS[lang][key] ?? TEXTS[lang][key]
  if (text === undefined) return key
  return vars ? format(text, vars) : text
}
