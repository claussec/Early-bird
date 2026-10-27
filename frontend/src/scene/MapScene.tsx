/**
 * 3D map network: countries as a dark relief, our plants as hubs, suppliers as towers at
 * their address, and an arc from every supplier to each plant it supplies.
 */
import { CameraControls, Html, QuadraticBezierLine, Sparkles } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Topology } from 'topojson-specification'
import { useI18n } from '../i18n'
import { GLOW, RISK } from '../theme'
import type { Light, Plant as PlantT, Supplier } from '../types'
import { buildCountries, loadWorld, makeProjection, spread, type Projection } from './geo'
import { Plant } from './Plant'
import { SupplierBuilding, buildingHeight } from './SupplierBuilding'

interface Props {
  suppliers: Supplier[]
  plants: PlantT[]
  visible: Set<string>
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

// Looks slightly left of centre: the filter panel covers the left edge of the screen.
const OVERVIEW: [number, number, number, number, number, number] = [-9, 66, 60, -9, 0, 4]

function Countries({ world, proj }: { world: Topology; proj: Projection }) {
  const geo = useMemo(() => buildCountries(world, proj), [world, proj])
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo])
  return (
    <group>
      <mesh geometry={geo.land} position={[0, 0.02, 0]} receiveShadow>
        <meshStandardMaterial color="#172233" roughness={0.95} metalness={0.05} />
      </mesh>
      <lineSegments geometry={geo.coast} position={[0, 0.05, 0]}>
        <lineBasicMaterial color="#3d6290" />
      </lineSegments>
      <lineSegments geometry={geo.borders} position={[0, 0.05, 0]}>
        <lineBasicMaterial color="#2c4363" />
      </lineSegments>
    </group>
  )
}

/** Supply link supplier → plant: an arc with a particle travelling towards the plant. */
function SupplyArc({ from, to, light, dimmed, emphasized }: { from: [number, number]; to: [number, number]; light: Light; dimmed: boolean; emphasized: boolean }) {
  const particle = useRef<THREE.Mesh>(null)
  const start = useMemo(() => new THREE.Vector3(from[0], 0.3, from[1]), [from])
  const end = useMemo(() => new THREE.Vector3(to[0], 0.6, to[1]), [to])
  const mid = useMemo(() => start.clone().lerp(end, 0.5).setY(1.5 + start.distanceTo(end) * 0.3), [start, end])
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(start, mid, end), [start, mid, end])
  const offset = useMemo(() => Math.random(), [])
  const speed = (light === 'red' ? 0.1 : 0.18) * Math.min(2, 12 / Math.max(4, start.distanceTo(end)))
  useFrame(({ clock }) => {
    if (particle.current) particle.current.position.copy(curve.getPoint((clock.getElapsedTime() * speed + offset) % 1))
  })
  const color = GLOW[light]
  return (
    <group>
      <QuadraticBezierLine
        start={start}
        end={end}
        mid={mid}
        color={color}
        lineWidth={emphasized ? 2.4 : 1.2}
        transparent
        opacity={dimmed ? 0.05 : emphasized ? 0.9 : 0.4}
        dashed={!emphasized}
        dashScale={2}
        dashSize={0.7}
        gapSize={0.35}
      />
      {!dimmed && (
        <mesh ref={particle}>
          <sphereGeometry args={[emphasized ? 0.26 : 0.18, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}

export function MapScene({ suppliers, plants, visible, selectedId, hoveredId, onSelect, onHover }: Props) {
  const { t } = useI18n()
  const controls = useRef<CameraControls>(null)
  const [world, setWorld] = useState<Topology | null>(null)
  useEffect(() => {
    loadWorld().then(setWorld).catch(() => setWorld(null))
  }, [])

  const located = useMemo(() => suppliers.filter((s) => s.location), [suppliers])
  const placedPlants = useMemo(() => plants.filter((p) => p.location), [plants])
  // The projection only changes when locations change, not on every status update.
  const locKey = [...located, ...placedPlants].map((e) => `${e.id}:${e.location!.lat},${e.location!.lon}`).join('|')
  const proj = useMemo(
    () => makeProjection([...located, ...placedPlants].map((e) => e.location!)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locKey],
  )
  const scale = Math.min(0.6, Math.max(0.28, proj.k * 0.1))

  const plantPos = useMemo(() => {
    const out: Record<string, [number, number]> = {}
    placedPlants.forEach((p) => (out[p.id] = proj.project(p.location!.lat, p.location!.lon)))
    return out
  }, [placedPlants, proj])

  const supplierPos = useMemo(() => {
    const items = located.map((s) => {
      const [x, z] = proj.project(s.location!.lat, s.location!.lon)
      return { id: s.id, x, z }
    })
    // Keep suppliers off the plant hubs and apart from each other.
    const hubs = Object.entries(plantPos).map(([id, [x, z]]) => ({ id, x, z }))
    const spaced = spread([...hubs, ...items], 3.2 * scale + 0.6).slice(hubs.length)
    return Object.fromEntries(spaced.map((p) => [p.id, [p.x, p.z] as [number, number]]))
  }, [located, proj, plantPos, scale])

  const selectedPlants = useMemo(() => {
    const s = suppliers.find((x) => x.id === (hoveredId ?? selectedId))
    return new Set(s?.plant_ids ?? [])
  }, [suppliers, hoveredId, selectedId])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const s = suppliers.find((x) => x.id === selectedId)
    const p = selectedId ? supplierPos[selectedId] : undefined
    if (s && p) {
      const h = buildingHeight(s) * scale
      c.setLookAt(p[0] - 2, h + 26, p[1] + 30, p[0] - 4, h * 0.5, p[1], true)
    } else {
      c.setLookAt(...OVERVIEW, true)
    }
  }, [selectedId, supplierPos, suppliers, scale])

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [-9, 66, 60], fov: 42 }} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={['#07090d']} />
      <fog attach="fog" args={['#07090d', 70, 160]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[25, 50, 20]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-60, 60, 60, -60, 1, 150]} />
      </directionalLight>

      {/* sea */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#05070b" roughness={1} />
      </mesh>
      {world && <Countries world={world} proj={proj} />}

      {placedPlants.map((p) => {
        const [x, z] = plantPos[p.id]
        const on = selectedPlants.has(p.id)
        return (
          <group key={p.id} position={[x, 0, z]} scale={scale * 0.55}>
            <pointLight position={[0, 6, 0]} intensity={on ? 40 : 18} color="#3987e5" distance={18} />
            <Plant label={p.name} highlighted={on} />
          </group>
        )
      })}

      {located.map((s) => {
        const from = supplierPos[s.id]
        if (!from) return null
        const light = RISK[s.status ?? 'none'].light
        const dimmed = !visible.has(s.id)
        const emphasized = s.id === selectedId || s.id === hoveredId
        return (
          <group key={s.id}>
            {(s.plant_ids ?? [])
              .filter((id) => plantPos[id])
              .map((id) => (
                <SupplyArc key={id} from={from} to={plantPos[id]} light={light} dimmed={dimmed} emphasized={emphasized} />
              ))}
            {!(s.plant_ids ?? []).some((id) => plantPos[id]) && !dimmed && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[from[0], 0.08, from[1]]}>
                <ringGeometry args={[2.9 * scale, 3.1 * scale, 48]} />
                <meshBasicMaterial color="#8b8a83" transparent opacity={0.35} />
              </mesh>
            )}
            <SupplierBuilding
              supplier={s}
              x={from[0]}
              z={from[1]}
              scale={scale}
              dimmed={dimmed}
              selected={s.id === selectedId}
              hovered={s.id === hoveredId}
              onSelect={(id) => onSelect(id)}
              onHover={onHover}
            />
          </group>
        )
      })}

      {!placedPlants.length && !located.length && (
        <Html center position={[0, 2, 0]}>
          <div className="pointer-events-none whitespace-nowrap text-xs text-ink-3">{t('scene.no_location_title')}</div>
        </Html>
      )}

      <Sparkles count={100} scale={[110, 16, 110]} position={[0, 7, 0]} size={1.4} speed={0.2} color="#5598e7" opacity={0.25} />
      <CameraControls ref={controls} minDistance={8} maxDistance={150} maxPolarAngle={Math.PI / 2.2} smoothTime={0.6} />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.8} luminanceThreshold={0.28} luminanceSmoothing={0.3} mipmapBlur />
        <Vignette offset={0.25} darkness={0.7} />
      </EffectComposer>
    </Canvas>
  )
}
