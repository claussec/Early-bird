import { Bot } from 'lucide-react'
import { useState } from 'react'
import type { Backend } from '../backend'
import { useI18n } from '../i18n'
import type { AgentMode } from '../types'

/** Artifact only: run the agents with Claude (viewer's claude.ai account) or rule-based. */
export function AgentModeControl({ agents }: { agents: NonNullable<Backend['agents']> }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<AgentMode>(agents.mode())
  const available = agents.available()
  const options: { id: AgentMode; label: string }[] = [
    { id: 'claude', label: 'Claude' },
    { id: 'rules', label: t('agents.rules') },
  ]
  return (
    <div
      className="glass flex items-center gap-1 rounded-2xl p-1 text-xs"
      title={available ? t('agents.available') : t('agents.unavailable')}
    >
      <Bot size={15} className="mx-1.5 hidden text-accent sm:block" />
      <span className="mr-1 hidden text-ink-3 2xl:inline">{t('agents.label')}</span>
      {options.map((o) => (
        <button
          key={o.id}
          disabled={o.id === 'claude' && !available}
          onClick={() => {
            agents.setMode(o.id)
            setMode(o.id)
          }}
          className={`rounded-xl px-2.5 py-1.5 font-semibold disabled:opacity-40 ${
            mode === o.id && (o.id !== 'claude' || available) ? 'bg-accent/20 text-ink-1' : 'text-ink-3 hover:text-ink-2'
          }`}
          aria-pressed={mode === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
