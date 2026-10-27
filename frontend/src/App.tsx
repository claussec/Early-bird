import { MapPinOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backend } from './backend'
import { DetailPanel } from './components/DetailPanel'
import { EMPTY_FILTERS, FilterPanel, applyFilters } from './components/FilterPanel'
import { ListView } from './components/ListView'
import { PlantManager } from './components/PlantManager'
import { SupplierForm } from './components/SupplierForm'
import { Legend, TopBar, type View } from './components/TopBar'
import { BatchResearch } from './components/WebResearch'
import { Rich, useI18n } from './i18n'
import { MapScene } from './scene/MapScene'
import { RadarScene } from './scene/RadarScene'
import type { Filters, Meta, Notification, Plant, RiskStatus, StepState, Supplier, SupplierDetail } from './types'

const VIEW_KEY = 'early-bird.view'

function initialView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (v === 'map' || v === 'radar' || v === 'list') return v
  } catch {
    /* per-viewer convenience only */
  }
  return 'map'
}

export default function App() {
  const { t, lang } = useI18n()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [plants, setPlants] = useState<Plant[]>([])
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
  const [form, setForm] = useState<'create' | 'edit' | null>(null)
  const [showPlants, setShowPlants] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setViewState] = useState<View>(initialView)

  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* ignore */
    }
  }

  const refresh = useCallback(async () => {
    try {
      const [m, s, p, n] = await Promise.all([backend.meta(), backend.suppliers(), backend.plants(), backend.notifications()])
      setMeta(m)
      setSuppliers(s)
      setPlants(p)
      setNotifications(n)
      setError(null)
    } catch (e) {
      const msg = (e as Error).message
      setError(backend.target === 'server' ? t('app.offline_server', { error: msg }) : t('app.offline', { error: msg }))
    }
  }, [t])

  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const reload = useCallback(async () => {
    await refresh()
    const id = selectedRef.current
    if (id) setDetail(await backend.supplier(id).catch(() => null))
  }, [refresh])

  // Initial load, and again after a language switch (the browser variants regenerate rule-based texts).
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

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
  const unlocated = view === 'map' ? suppliers.filter((s) => !s.location).length : 0

  const runAnalysis = async () => {
    if (!selectedId || !meta) return
    const id = selectedId
    setRunning(true)
    setSteps(Object.fromEntries(meta.steps.map((s) => [s, { status: 'pending', summary: '' }])))
    try {
      await backend.analyze(id, (e) => {
        if (e.type === 'step') setSteps((prev) => ({ ...prev, [e.step!]: { status: e.status as StepState['status'], summary: e.summary ?? '' } }))
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

  const onSaved = async (s: Supplier) => {
    const created = form === 'create'
    setForm(null)
    if (created) setFilters(EMPTY_FILTERS)
    await refresh()
    setSelectedId(s.id)
    setDetail(await backend.supplier(s.id).catch(() => null))
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
          setSuppliers((list) => list.map((s) => (s.id === e.supplier_id ? { ...s, status: e.status as RiskStatus } : s)))
        }
      })
      await reload()
    } catch (e) {
      setNotice((e as Error).message)
    } finally {
      setCycle((c) => ({ ...c, running: false }))
    }
  }

  const sceneProps = { suppliers, visible: visibleIds, selectedId, hoveredId, onSelect: setSelectedId, onHover: setHoveredId }

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0 isolate z-0">
        {meta && view === 'map' && <MapScene {...sceneProps} plants={plants} />}
        {meta && view === 'radar' && <RadarScene {...sceneProps} commodities={meta.commodities} />}
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-3 md:gap-4 md:p-4">
        <TopBar
          meta={meta}
          suppliers={suppliers}
          notifications={notifications}
          cycle={cycle}
          view={view}
          onView={setView}
          onCycle={runCycle}
          onSelect={setSelectedId}
          onPlants={() => setShowPlants(true)}
          onAutomodeFinished={reload}
        />
        {error && <div className="glass pointer-events-auto self-start rounded-xl border-crit/50 px-4 py-3 text-sm text-[#ff8a8a]">{error}</div>}
        {meta && backend.storage && !backend.storage.persistent() && (
          <div className="glass pointer-events-auto self-start rounded-xl border-warn/40 px-4 py-2.5 text-xs text-ink-2">
            <Rich text={backend.target === 'demo' ? t('app.demo_banner') : t('app.no_storage')} />
          </div>
        )}
        {notice && (
          <div
            role="alert"
            className="glass pointer-events-auto flex items-start gap-3 self-center rounded-xl border-crit/50 px-4 py-2.5 text-sm text-[#ff8a8a]"
          >
            {notice}
            <button onClick={() => setNotice(null)} className="text-xs text-ink-3 hover:text-ink-1">
              {t('common.close')}
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col items-stretch justify-between gap-3 md:flex-row md:gap-4">
          {meta && (
            <div className={`${detail ? 'hidden md:flex' : 'flex'} min-h-0 max-h-full ${view === 'list' ? 'md:self-start' : ''}`}>
              <FilterPanel
                filters={filters}
                setFilters={setFilters}
                suppliers={suppliers}
                visible={visible}
                commodities={meta.commodities}
                countries={meta.countries}
                plants={plants}
                compact={view === 'list'}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onHover={setHoveredId}
                onAdd={() => setForm('create')}
                onBatchResearch={backend.webResearch ? () => setShowBatch(true) : undefined}
                onRemoveDemoData={backend.storage?.hasDemoData() ? removeDemoData : undefined}
              />
            </div>
          )}
          {meta && view === 'list' && (
            <div className={`${detail ? 'hidden xl:flex' : 'flex'} min-h-0 min-w-0 flex-1`}>
              <ListView suppliers={visible} plants={plants} selectedId={selectedId} onSelect={setSelectedId} onHover={setHoveredId} />
            </div>
          )}
          {detail && meta && (
            <DetailPanel
              key={detail.supplier.id}
              detail={detail}
              meta={meta}
              plants={plants}
              steps={steps}
              running={running}
              onRun={runAnalysis}
              onClose={() => setSelectedId(null)}
              onEdit={() => setForm('edit')}
              onDelete={deleteSelected}
              onChanged={reload}
            />
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          {unlocated > 0 && (
            <div className="glass pointer-events-auto flex items-center gap-1.5 rounded-2xl px-3 py-2 text-[11px] text-ink-3" title={t('scene.no_location_title')}>
              <MapPinOff size={13} /> {t('scene.no_location', { n: unlocated })}
            </div>
          )}
          <Legend view={view} />
        </div>
      </div>
      {form && meta && (
        <SupplierForm
          commodities={meta.commodities}
          plants={plants}
          supplier={form === 'edit' ? detail?.supplier : undefined}
          onSaved={onSaved}
          onClose={() => setForm(null)}
        />
      )}
      {showPlants && <PlantManager plants={plants} onChanged={reload} onClose={() => setShowPlants(false)} />}
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
