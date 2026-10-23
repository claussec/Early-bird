import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backend } from './backend'
import { BatchResearch } from './components/WebResearch'
import { DetailPanel } from './components/DetailPanel'
import { EMPTY_FILTERS, FilterPanel, applyFilters } from './components/FilterPanel'
import { SupplierForm } from './components/SupplierForm'
import { Legend, TopBar } from './components/TopBar'
import { Scene } from './scene/Scene'
import type { Filters, Meta, Notification, StepState, Supplier, SupplierDetail } from './types'

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  // Deep link from notification e-mails / Teams cards: /?supplier=S1002
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('supplier'))
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupplierDetail | null>(null)
  const [steps, setSteps] = useState<Record<string, StepState> | null>(null)
  const [running, setRunning] = useState(false)
  const [cycle, setCycle] = useState({ running: false, done: 0, total: 0, current: '' })
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [m, s, n] = await Promise.all([backend.meta(), backend.suppliers(), backend.notifications()])
      setMeta(m)
      setSuppliers(s)
      setNotifications(n)
      setError(null)
    } catch (e) {
      setError(
        backend.target === 'server'
          ? `Backend nicht erreichbar (${(e as Error).message}). Läuft der API-Server auf Port 8000?`
          : `Daten konnten nicht geladen werden (${(e as Error).message}).`,
      )
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setSteps(null)
    if (!selectedId) {
      setDetail(null)
      return
    }
    backend
      .supplier(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [selectedId])

  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const reload = useCallback(async () => {
    await refresh()
    const id = selectedRef.current
    if (id) setDetail(await backend.supplier(id).catch(() => null))
  }, [refresh])

  // Artifact: changes by other viewers (or other tabs) arrive live.
  useEffect(() => {
    if (!backend.subscribe) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = backend.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [reload])

  const visible = useMemo(() => applyFilters(suppliers, filters), [suppliers, filters])
  const visibleIds = useMemo(() => new Set(visible.map((s) => s.id)), [visible])

  const runAnalysis = async () => {
    if (!selectedId || !meta) return
    const id = selectedId
    setRunning(true)
    setSteps(Object.fromEntries(meta.steps.map(([s]) => [s, { status: 'pending', summary: '' }])))
    try {
      await backend.analyze(id, (e) => {
        if (e.type === 'step') setSteps((prev) => ({ ...prev, [e.step!]: { status: e.status!, summary: e.summary ?? '' } }))
      })
      const [d] = await Promise.all([backend.supplier(id), refresh()])
      setDetail(d)
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const deleteSelected = async () => {
    if (!selectedId) return
    try {
      await backend.deleteSupplier(selectedId)
      setSelectedId(null)
      await refresh()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const onCreated = async (s: Supplier) => {
    setShowForm(false)
    setFilters(EMPTY_FILTERS)
    await refresh()
    setSelectedId(s.id)
  }

  const removeDemoData = async () => {
    try {
      await backend.storage?.removeDemoData()
      setSelectedId(null)
      setFilters(EMPTY_FILTERS)
      await refresh()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const runCycle = async () => {
    setCycle({ running: true, done: 0, total: suppliers.length, current: '' })
    try {
      await backend.cycle((e) => {
        if (e.type === 'supplier') setCycle((c) => ({ ...c, current: e.name?.split(' ')[0] ?? '' }))
        if (e.type === 'supplier_done') {
          setCycle((c) => ({ ...c, done: c.done + 1 }))
          setSuppliers((list) => list.map((s) => (s.id === e.supplier_id ? { ...s, traffic_light: e.traffic_light, score: e.score } : s)))
        }
      })
      await reload()
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setCycle((c) => ({ ...c, running: false }))
    }
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0 isolate z-0">
        {meta && (
          <Scene
            suppliers={suppliers}
            commodities={meta.commodities}
            visible={visibleIds}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={setSelectedId}
            onHover={setHoveredId}
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-3 md:gap-4 md:p-4">
        <TopBar
          meta={meta}
          suppliers={suppliers}
          notifications={notifications}
          cycle={cycle}
          onCycle={runCycle}
          onSelect={setSelectedId}
          onAutomodeFinished={reload}
        />
        {error && (
          <div className="glass pointer-events-auto self-start rounded-xl border-crit/50 px-4 py-3 text-sm text-[#ff8a8a]">{error}</div>
        )}
        {meta && backend.storage && !backend.storage.persistent() && (
          <div className="glass pointer-events-auto self-start rounded-xl border-warn/40 px-4 py-2.5 text-xs text-ink-2">
            <b className="text-ink-1">Ohne Speicher:</b> In dieser Ansicht steht der Speicher des Artefakts nicht zur Verfügung (z. B. nicht
            angemeldet). Änderungen gelten nur bis zum Neuladen.
          </div>
        )}
        {notice && (
          <div
            role="alert"
            className="glass pointer-events-auto flex items-start gap-3 self-center rounded-xl border-crit/50 px-4 py-2.5 text-sm text-[#ff8a8a]"
          >
            {notice}
            <button onClick={() => setNotice(null)} className="text-xs text-ink-3 hover:text-ink-1">
              Schließen
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col items-stretch justify-between gap-3 md:flex-row md:gap-4">
          {meta && (
            <div className={`${detail ? 'hidden md:flex' : 'flex'} min-h-0 max-h-full`}>
              <FilterPanel
                filters={filters}
                setFilters={setFilters}
                suppliers={suppliers}
                visible={visible}
                commodities={meta.commodities}
                countries={meta.countries}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onHover={setHoveredId}
                onAdd={() => setShowForm(true)}
                onBatchResearch={backend.webResearch ? () => setShowBatch(true) : undefined}
                onRemoveDemoData={backend.storage?.hasDemoData() ? removeDemoData : undefined}
              />
            </div>
          )}
          {detail && meta && (
            <DetailPanel
              key={detail.supplier.id}
              detail={detail}
              meta={meta}
              steps={steps}
              running={running}
              onRun={runAnalysis}
              onClose={() => setSelectedId(null)}
              onDelete={deleteSelected}
              onChanged={reload}
            />
          )}
        </div>
        <div className="flex justify-center">
          <Legend />
        </div>
      </div>
      {showForm && meta && <SupplierForm commodities={meta.commodities} onCreated={onCreated} onClose={() => setShowForm(false)} />}
      {showBatch && backend.webResearch && (
        <BatchResearch
          web={backend.webResearch}
          suppliers={visible}
          onDone={async () => {
            setShowBatch(false)
            await reload()
          }}
          onClose={() => setShowBatch(false)}
        />
      )}
    </div>
  )
}
