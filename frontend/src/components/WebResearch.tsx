/**
 * Artifact only: web research through a regular Claude chat.
 * 1. Copy the generated research prompt, 2. run it in Claude with web search,
 * 3. paste the answer back; the signals are previewed, stored and the supplier re-evaluated.
 */
import { Check, ClipboardCopy, ExternalLink, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { backend, type Backend } from '../backend'
import { batchResearchPrompt, extractJson, normalizeSignals, researchPrompt, signalKey, type ParsedSignals } from '../engine/external'
import type { ExternalDoc, Supplier } from '../types'
import { StatusBadge } from './ui'

type Web = NonNullable<Backend['webResearch']>

interface Candidate {
  supplierId: string
  doc: ExternalDoc
  duplicate: boolean
  selected: boolean
}

const MAX_BATCH = 15

async function parseAnswer(text: string, scope: Supplier[], web: Web): Promise<ParsedSignals[]> {
  const value = extractJson(text)
  const groups = value === undefined ? [] : normalizeSignals(value)
  if (groups.length) return groups
  if (web.canStructure()) return web.structure(text, scope)
  throw new Error('In der Antwort wurde kein JSON-Block gefunden. Bitte die komplette Antwort von Claude einfügen.')
}

/** Assigns parsed signals to suppliers; with one supplier in scope everything belongs to it. */
function toCandidates(groups: ParsedSignals[], scope: Supplier[], existing: (id: string) => ExternalDoc[]) {
  const byNumber = new Map(scope.map((s) => [s.number.toLowerCase(), s]))
  const unmatched: string[] = []
  const out: Candidate[] = []
  for (const g of groups) {
    const s = (g.supplier_number && byNumber.get(g.supplier_number.toLowerCase())) || (scope.length === 1 ? scope[0] : undefined)
    if (!s) {
      if (g.signals.length) unmatched.push(g.supplier_number ?? 'ohne Nummer')
      continue
    }
    const known = new Set(existing(s.id).map(signalKey))
    for (const doc of g.signals) {
      const duplicate = known.has(signalKey(doc)) || out.some((c) => c.supplierId === s.id && signalKey(c.doc) === signalKey(doc))
      out.push({ supplierId: s.id, doc, duplicate, selected: !duplicate && doc.signal !== 'neutral' })
    }
  }
  return { candidates: out, unmatched }
}

function SignalBadge({ doc }: { doc: ExternalDoc }) {
  if (doc.signal === 'risk')
    return (
      <StatusBadge light={doc.severity === 3 ? 'red' : 'yellow'} size="sm">
        Risiko · Schwere {doc.severity}
      </StatusBadge>
    )
  if (doc.signal === 'success')
    return (
      <StatusBadge light="green" size="sm">
        Erfolg
      </StatusBadge>
    )
  return <span className="text-[11px] text-ink-3">neutral</span>
}

function SignalCard({ doc, action }: { doc: ExternalDoc; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-0/50 p-3">
      <div className="flex items-center gap-2 text-[11px] text-ink-3">
        <span>{doc.date || 'ohne Datum'}</span>·<span>{doc.category}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <SignalBadge doc={doc} />
          {action}
        </span>
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-ink-1">
        {doc.url ? (
          <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 hover:underline">
            {doc.title} <ExternalLink size={12} className="mt-1 shrink-0 text-ink-3" />
          </a>
        ) : (
          doc.title
        )}
      </div>
      {doc.source && <div className="mt-0.5 text-[11px] text-ink-3">{doc.source}</div>}
      <div className="mt-1 text-xs text-ink-3">{doc.rationale}</div>
    </div>
  )
}

/** Step 1: the prompt, copied with one click (falls back to a selectable text field). */
function PromptStep({ prompt, label }: { prompt: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const [show, setShow] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setShow(true)
      setTimeout(() => area.current?.select(), 0)
    }
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={copy}
          className="flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white hover:brightness-110"
        >
          {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
          {copied ? 'Kopiert' : label}
        </button>
        <button onClick={() => setShow(!show)} className="text-xs text-ink-3 hover:text-ink-1">
          {show ? 'Prompt ausblenden' : 'Prompt anzeigen'}
        </button>
      </div>
      {show && (
        <textarea
          ref={area}
          readOnly
          value={prompt}
          className="scroll-thin mt-2 h-40 w-full rounded-xl border border-line bg-surface-0/70 p-2 font-mono text-[11px] text-ink-2"
        />
      )}
      <p className="mt-2 text-xs text-ink-3">
        In einem neuen Claude-Chat einfügen, <b className="text-ink-2">Websuche</b> aktivieren und absenden. Die komplette Antwort kopierst
        du dann unten hinein.
      </p>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent/60 text-[10px] font-semibold text-accent">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-[13px] font-medium text-ink-1">{title}</div>
        {children}
      </div>
    </div>
  )
}

function useImport(web: Web, scope: Supplier[], existing: (id: string) => ExternalDoc[]) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const analyse = async (loadExisting?: () => Promise<(id: string) => ExternalDoc[]>) => {
    setBusy(true)
    setError(null)
    try {
      const known = loadExisting ? await loadExisting() : existing
      const r = toCandidates(await parseAnswer(text, scope, web), scope, known)
      setCandidates(r.candidates)
      setUnmatched(r.unmatched)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (i: number) => setCandidates((c) => c && c.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))
  const reset = () => {
    setText('')
    setCandidates(null)
    setUnmatched([])
  }
  return { text, setText, busy, setBusy, error, setError, candidates, unmatched, analyse, toggle, reset }
}

function PasteStep({ imp, placeholder }: { imp: ReturnType<typeof useImport>; placeholder: string }) {
  return (
    <>
      <textarea
        id="web-research-answer"
        value={imp.text}
        onChange={(e) => imp.setText(e.target.value)}
        placeholder={placeholder}
        className="scroll-thin h-28 w-full rounded-xl border border-line bg-surface-0/70 p-2 text-xs text-ink-1 placeholder:text-ink-3 focus:border-accent/70 focus:outline-none"
      />
      <button
        onClick={() => imp.analyse()}
        disabled={!imp.text.trim() || imp.busy}
        className="mt-2 flex items-center gap-2 rounded-xl border border-accent/50 px-3 py-2 text-xs font-semibold text-ink-1 hover:bg-accent/10 disabled:opacity-50"
      >
        {imp.busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} className="text-accent" />}
        Antwort auswerten
      </button>
    </>
  )
}

function Preview({ imp, names }: { imp: ReturnType<typeof useImport>; names?: Record<string, string> }) {
  if (!imp.candidates) return null
  if (!imp.candidates.length) return <p className="text-xs text-ink-3">Claude hat keine Meldungen gefunden. Es wird nichts geändert.</p>
  return (
    <div className="space-y-2">
      {imp.candidates.map((c, i) => (
        <label key={i} className={`flex cursor-pointer gap-2 ${c.selected ? '' : 'opacity-50'}`}>
          <input type="checkbox" checked={c.selected} onChange={() => imp.toggle(i)} className="mt-3" />
          <div className="min-w-0 flex-1">
            {names && <div className="mb-1 text-[11px] font-medium text-ink-2">{names[c.supplierId]}</div>}
            <SignalCard doc={c.doc} />
            {c.duplicate && <div className="mt-1 text-[11px] text-ink-3">Bereits vorhanden</div>}
          </div>
        </label>
      ))}
      {imp.unmatched.length > 0 && (
        <p className="text-xs text-ink-3">Nicht zugeordnet (Lieferantennummer unbekannt): {imp.unmatched.join(', ')}</p>
      )}
    </div>
  )
}

/** Web tab of one supplier. */
export function WebResearchPanel({
  web,
  supplier,
  signals,
  onChanged,
}: {
  web: Web
  supplier: Supplier
  signals: ExternalDoc[]
  onChanged: () => void
}) {
  const imp = useImport(web, [supplier], () => signals)
  const prompt = useMemo(() => researchPrompt(supplier), [supplier])
  const selected = imp.candidates?.filter((c) => c.selected) ?? []

  const apply = async () => {
    imp.setBusy(true)
    imp.setError(null)
    try {
      await web.save(supplier.id, [...signals, ...selected.map((c) => c.doc)], 'agents')
      imp.reset()
      onChanged()
    } catch (e) {
      imp.setError((e as Error).message)
    } finally {
      imp.setBusy(false)
    }
  }

  const remove = async (i: number) => {
    try {
      await web.save(
        supplier.id,
        signals.filter((_, j) => j !== i),
        'rules',
      )
      onChanged()
    } catch (e) {
      imp.setError((e as Error).message)
    }
  }

  return (
    <div className="mt-4 space-y-5">
      <section className="space-y-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Web-Recherche mit Claude</div>
        <Step n={1} title="Recherche-Prompt kopieren">
          <PromptStep prompt={prompt} label="Recherche-Prompt kopieren" />
        </Step>
        <Step n={2} title="Antwort von Claude einfügen">
          <PasteStep imp={imp} placeholder="Komplette Antwort von Claude hier einfügen …" />
        </Step>
        {imp.candidates && (
          <Step n={3} title="Meldungen prüfen & übernehmen">
            <Preview imp={imp} />
            {selected.length > 0 && (
              <button
                onClick={apply}
                disabled={imp.busy}
                className="mt-3 flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                {imp.busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                {selected.length} Meldung(en) übernehmen & neu bewerten
              </button>
            )}
          </Step>
        )}
        {imp.error && <p className="text-xs text-[#ff8a8a]">{imp.error}</p>}
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          Gespeicherte Web-Signale ({signals.length})
        </h3>
        <div className="space-y-2">
          {signals.map((d, i) => (
            <SignalCard
              key={`${signalKey(d)}-${i}`}
              doc={d}
              action={
                <button
                  onClick={() => remove(i)}
                  className="rounded p-0.5 text-ink-3 hover:text-[#ff8a8a]"
                  aria-label="Signal entfernen"
                  title="Signal entfernen"
                >
                  <Trash2 size={13} />
                </button>
              }
            />
          ))}
          {!signals.length && <p className="text-xs text-ink-3">Noch keine Web-Signale. Starte oben mit dem Recherche-Prompt.</p>}
        </div>
      </section>
    </div>
  )
}

/** Batch research for several suppliers at once (modal). */
export function BatchResearch({
  web,
  suppliers,
  onDone,
  onClose,
}: {
  web: Web
  suppliers: Supplier[]
  onDone: () => void
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(suppliers.slice(0, MAX_BATCH).map((s) => s.id)))
  const scope = suppliers.filter((s) => chosen.has(s.id))
  const [existing, setExisting] = useState<Record<string, ExternalDoc[]>>({})
  const imp = useImport(web, scope, (id) => existing[id] ?? [])
  const prompt = useMemo(() => batchResearchPrompt(scope), [scope])
  const names = Object.fromEntries(suppliers.map((s) => [s.id, `${s.name} (${s.number})`]))
  const selected = imp.candidates?.filter((c) => c.selected) ?? []
  const [progress, setProgress] = useState<string | null>(null)

  const toggle = (id: string) =>
    setChosen((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_BATCH) next.add(id)
      return next
    })

  // Loads the stored signals of the chosen suppliers so duplicates are recognized and kept.
  const analyse = () =>
    imp.analyse(async () => {
      const entries = await Promise.all(scope.map(async (s) => [s.id, (await backend.supplier(s.id)).report?.external ?? []] as const))
      const map = Object.fromEntries(entries)
      setExisting(map)
      return (id: string) => map[id] ?? []
    })

  const apply = async () => {
    imp.setBusy(true)
    imp.setError(null)
    try {
      const bySupplier = new Map<string, ExternalDoc[]>()
      selected.forEach((c) => bySupplier.set(c.supplierId, [...(bySupplier.get(c.supplierId) ?? []), c.doc]))
      let i = 0
      for (const [id, docs] of bySupplier) {
        setProgress(`${++i}/${bySupplier.size}: ${names[id]}`)
        await web.save(id, [...(existing[id] ?? []), ...docs], 'rules')
      }
      onDone()
    } catch (e) {
      imp.setError((e as Error).message)
    } finally {
      imp.setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm md:p-8">
      <div className="glass my-auto w-full max-w-2xl rounded-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-1">Sammel-Recherche</h2>
            <p className="text-xs text-ink-3">Web-Signale für mehrere Lieferanten mit einem Claude-Chat holen (bis zu {MAX_BATCH}).</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1" aria-label="Schließen">
            <X size={18} />
          </button>
        </header>
        <div className="space-y-5 px-5 py-4">
          <Step n={1} title={`Lieferanten wählen (${scope.length} ausgewählt)`}>
            <div className="scroll-thin max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-line p-2">
              {suppliers.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs text-ink-2 hover:bg-white/5"
                >
                  <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="font-mono text-ink-3">{s.number}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              Vorausgewählt sind die Lieferanten, die gerade durch Suche und Filter sichtbar sind.
            </p>
          </Step>
          <Step n={2} title="Sammel-Prompt kopieren">
            {scope.length ? (
              <PromptStep prompt={prompt} label="Sammel-Prompt kopieren" />
            ) : (
              <p className="text-xs text-ink-3">Bitte mindestens einen Lieferanten wählen.</p>
            )}
          </Step>
          <Step n={3} title="Antwort von Claude einfügen">
            <PasteStep imp={{ ...imp, analyse }} placeholder="Komplette Antwort von Claude hier einfügen …" />
          </Step>
          {imp.candidates && (
            <Step n={4} title="Meldungen prüfen & übernehmen">
              <Preview imp={imp} names={names} />
            </Step>
          )}
          {imp.error && <p className="text-xs text-[#ff8a8a]">{imp.error}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4">
          {progress && <span className="mr-auto text-xs text-ink-3">Speichere {progress}</span>}
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-2 hover:bg-white/5">
            Schließen
          </button>
          <button
            onClick={apply}
            disabled={!selected.length || imp.busy}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {imp.busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            {selected.length} Meldung(en) übernehmen
          </button>
        </footer>
        <p className="px-5 pb-4 text-[11px] text-ink-3">
          Nach dem Übernehmen werden die betroffenen Lieferanten regelbasiert neu bewertet. Eine Claude-Analyse startest du je Lieferant mit
          „Analyse jetzt ausführen“.
        </p>
      </div>
    </div>
  )
}
