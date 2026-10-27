import { CameraControls, Grid, Html, Sparkles } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useI18n } from '../i18n'
import { RISK } from '../theme'
import type { Supplier } from '../types'
import { SECTOR_RADIUS, layoutSuppliers } from './layout'
import { Plant } from './Plant'
import { FlowLine, SupplierBuilding, buildingHeight } from './SupplierBuilding'

interface Props {
  suppliers: Supplier[]
  commodities: string[]
  visible: Set<string>
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
}

const OVERVIEW: [number, number, number, number, number, number] = [0, 44, 52, 0, 0, 2]

function SectorLines({ sectors }: { sectors: { name: string; center: number; start: number }[] }) {
  const geometry = useMemo(() => {
    const pts: THREE.Vector3[] = []
    sectors.forEach((s) => {
      pts.push(new THREE.Vector3(Math.cos(s.start) * 10, 0.03, Math.sin(s.start) * 10))
      pts.push(new THREE.Vector3(Math.cos(s.start) * 36, 0.03, Math.sin(s.start) * 36))
    })
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [sectors])
  return (
    <>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#2a3446" />
      </lineSegments>
      {[19, 27, 36].map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[r - 0.04, r + 0.04, 128]} />
          <meshBasicMaterial color="#1c2431" />
        </mesh>
      ))}
      {sectors.map((s) => (
        <Html
          key={s.name}
          position={[Math.cos(s.center) * SECTOR_RADIUS, 0.1, Math.sin(s.center) * SECTOR_RADIUS]}
          center
          distanceFactor={45}
          zIndexRange={[5, 0]}
        >
          <div className="pointer-events-none whitespace-nowrap text-[15px] font-semibold uppercase tracking-[0.2em] text-ink-3/80">
            {s.name}
          </div>
        </Html>
      ))}
    </>
  )
}

export function RadarScene({ suppliers, commodities, visible, selectedId, hoveredId, onSelect, onHover }: Props) {
  const { t } = useI18n()
  const controls = useRef<CameraControls>(null)
  const { positions, sectors } = useMemo(() => layoutSuppliers(suppliers, commodities), [suppliers, commodities])

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const s = suppliers.find((x) => x.id === selectedId)
    const p = selectedId ? positions[selectedId] : undefined
    if (s && p) {
      const h = buildingHeight(s)
      const dir = new THREE.Vector2(p.x, p.z).normalize()
      c.setLookAt(p.x + dir.x * 26, h + 16, p.z + dir.y * 26, p.x * 0.8, h * 0.5, p.z * 0.8, true)
    } else {
      c.setLookAt(...OVERVIEW, true)
    }
  }, [selectedId, positions, suppliers])

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 44, 52], fov: 42 }} onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={['#07090d']} />
      <fog attach="fog" args={['#07090d', 60, 130]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[20, 40, 15]} intensity={1.2} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-45, 45, 45, -45, 1, 120]} />
      </directionalLight>
      <pointLight position={[0, 12, 0]} intensity={60} color="#3987e5" distance={40} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[80, 96]} />
        <meshStandardMaterial color="#0a0d12" roughness={0.9} />
      </mesh>
      <Grid
        position={[0, 0.01, 0]}
        args={[120, 120]}
        cellSize={2}
        cellThickness={0.5}
        cellColor="#141b25"
        sectionSize={10}
        sectionThickness={0.8}
        sectionColor="#1d2633"
        fadeDistance={95}
        fadeStrength={1.5}
        infiniteGrid
      />
      <SectorLines sectors={sectors} />
      <Plant label={t('scene.plant')} />

      {suppliers.map((s) => {
        const p = positions[s.id]
        if (!p) return null
        const dimmed = !visible.has(s.id)
        return (
          <group key={s.id}>
            <FlowLine x={p.x} z={p.z} light={RISK[s.status ?? 'none'].light} dimmed={dimmed} />
            <SupplierBuilding
              supplier={s}
              x={p.x}
              z={p.z}
              dimmed={dimmed}
              selected={s.id === selectedId}
              hovered={s.id === hoveredId}
              onSelect={(id) => onSelect(id)}
              onHover={onHover}
            />
          </group>
        )
      })}

      <Sparkles count={120} scale={[90, 20, 90]} position={[0, 8, 0]} size={1.6} speed={0.25} color="#5598e7" opacity={0.35} />

      <CameraControls
        ref={controls}
        minDistance={12}
        maxDistance={110}
        maxPolarAngle={Math.PI / 2.15}
        smoothTime={0.6}
      />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.3} mipmapBlur />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  )
}
