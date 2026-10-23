import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, stream } from './api'
import { DetailPanel } from './components/DetailPanel'
import { EMPTY_FILTERS, FilterPanel, applyFilters } from './components/FilterPanel'
import { Legend, TopBar } from './components/TopBar'
import { Scene } from './scene/Scene'
import type { Filters, Meta, Notification, StepState, Supplier, SupplierDetail } from './types'

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupplierDetail | null>(null)
  const [steps, setSteps] = useState<Record<string, StepState> | null>(null)
  const [running, setRunning] = useState(false)
  const [cycle, setCycle] = useState({ running: false, done: 0, total: 0, current: '' })
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [m, s, n] = await Promise.all([api.meta(), api.suppliers(), api.notifications()])
      setMeta(m)
      setSuppliers(s)
      setNotifications(n)
      setError(null)
    } catch (e) {
      setError(`Backend nicht erreichbar (${(e as Error).message}). Läuft der API-Server auf Port 8000?`)
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
    api
      .supplier(selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [selectedId])

  const visible = useMemo(() => applyFilters(suppliers, filters), [suppliers, filters])
  const visibleIds = useMemo(() => new Set(visible.map((s) => s.id)), [visible])

  const runAnalysis = async () => {
    if (!selectedId || !meta) return
    const id = selectedId
    setRunning(true)
    setSteps(Object.fromEntries(meta.steps.map(([s]) => [s, { status: 'pending', summary: '' }])))
    try {
      await stream(`/api/suppliers/${id}/analyze`, (e) => {
        if (e.type === 'step') setSteps((prev) => ({ ...prev, [e.step!]: { status: e.status!, summary: e.summary ?? '' } }))
      })
      const [d] = await Promise.all([api.supplier(id), refresh()])
      setDetail(d)
    } finally {
      setRunning(false)
    }
  }

  const runCycle = async () => {
    setCycle({ running: true, done: 0, total: suppliers.length, current: '' })
    try {
      await stream('/api/cycle', (e) => {
        if (e.type === 'supplier') setCycle((c) => ({ ...c, current: e.name?.split(' ')[0] ?? '' }))
        if (e.type === 'supplier_done') {
          setCycle((c) => ({ ...c, done: c.done + 1 }))
          setSuppliers((list) => list.map((s) => (s.id === e.supplier_id ? { ...s, traffic_light: e.traffic_light, score: e.score } : s)))
        }
      })
      await refresh()
      if (selectedId) setDetail(await api.supplier(selectedId))
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
        <TopBar meta={meta} suppliers={suppliers} notifications={notifications} cycle={cycle} onCycle={runCycle} onSelect={setSelectedId} />
        {error && (
          <div className="glass pointer-events-auto self-start rounded-xl border-crit/50 px-4 py-3 text-sm text-[#ff8a8a]">{error}</div>
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
            />
          )}
        </div>
        <div className="flex justify-center">
          <Legend />
        </div>
      </div>
    </div>
  )
}
