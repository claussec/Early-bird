import { Edges, Html, QuadraticBezierLine } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { GLOW, STATUS, fmt } from '../theme'
import type { Light, Supplier } from '../types'

interface Props {
  supplier: Supplier
  x: number
  z: number
  dimmed: boolean
  selected: boolean
  hovered: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

const WIDTH = 2.4

export function buildingHeight(s: Supplier) {
  return 1.4 + Math.min(9, (s.purchase_volume ?? 5) * 0.32)
}

export function SupplierBuilding({ supplier: s, x, z, dimmed, selected, hovered, onSelect, onHover }: Props) {
  const light: Light = s.traffic_light ?? 'green'
  const glow = GLOW[light]
  const h = buildingHeight(s)
  const opacity = dimmed ? 0.12 : 1
  const body = useRef<THREE.MeshStandardMaterial>(null)
  const beacon = useRef<THREE.Group>(null)
  const halo = useRef<THREE.Mesh>(null)
  const share = Math.min(1, (s.customer_share ?? 0) / 100)
  const bands = useMemo(() => {
    const out: number[] = []
    for (let y = 0.7; y < h - 0.3; y += 0.75) out.push(y)
    return out
  }, [h])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (body.current) {
      const base = selected || hovered ? 0.35 : 0.12
      body.current.emissiveIntensity = s.escalate && !dimmed ? base + 0.18 * (1 + Math.sin(t * 3)) : base
    }
    if (beacon.current) {
      beacon.current.position.y = h + 1.4 + Math.sin(t * 2 + x) * 0.25
      beacon.current.rotation.y = t * 1.5
    }
    if (halo.current) {
      const p = (t * 0.6 + (x + z) * 0.05) % 1
      halo.current.scale.setScalar(1 + p * 1.8)
      ;(halo.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.5 * opacity
    }
  })

  return (
    <group position={[x, 0, z]}>
      {/* hit area larger than the mark */}
      <mesh
        position={[0, h / 2, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(s.id)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover(s.id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          onHover(null)
          document.body.style.cursor = 'auto'
        }}
      >
        <boxGeometry args={[WIDTH + 1.2, h + 1.5, WIDTH + 1.2]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* foundation */}
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[2.3, 2.4, 0.12, 48]} />
        <meshStandardMaterial color="#121821" transparent opacity={opacity} />
      </mesh>
      {/* customer-share arc on the ground */}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.14, 0]}>
        <ringGeometry args={[2.0, 2.22, 64, 1, 0, Math.PI * 2]} />
        <meshBasicMaterial color="#2a3240" transparent opacity={opacity} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.15, 0]}>
        <ringGeometry args={[2.0, 2.22, 64, 1, 0, Math.PI * 2 * share]} />
        <meshBasicMaterial color={share >= 0.5 ? '#ff8a5c' : '#9ec5f4'} toneMapped={false} transparent opacity={opacity} />
      </mesh>

      {/* tower */}
      <mesh position={[0, h / 2 + 0.12, 0]} castShadow>
        <boxGeometry args={[WIDTH, h, WIDTH]} />
        <meshStandardMaterial
          ref={body}
          color="#1a212d"
          metalness={0.6}
          roughness={0.3}
          emissive={glow}
          emissiveIntensity={0.12}
          transparent
          opacity={opacity}
        />
        <Edges color={glow} threshold={15} transparent opacity={opacity} />
      </mesh>
      {bands.map((y) => (
        <mesh key={y} position={[0, y + 0.12, 0]}>
          <boxGeometry args={[WIDTH + 0.03, 0.07, WIDTH + 0.03]} />
          <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.55 * opacity} />
        </mesh>
      ))}
      <mesh position={[0, h + 0.14, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[WIDTH - 0.3, WIDTH - 0.3]} />
        <meshBasicMaterial color={glow} toneMapped={false} transparent opacity={0.85 * opacity} />
      </mesh>

      {s.escalate && !dimmed && (
        <>
          <group ref={beacon}>
            <mesh>
              <octahedronGeometry args={[0.55]} />
              <meshBasicMaterial color={glow} toneMapped={false} />
            </mesh>
          </group>
          <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
            <ringGeometry args={[2.3, 2.45, 64]} />
            <meshBasicMaterial color={glow} transparent toneMapped={false} />
          </mesh>
        </>
      )}

      {(hovered || selected) && !dimmed && (
        <Html position={[0, h + 3.2, 0]} center zIndexRange={[20, 10]}>
          <div className="glass pointer-events-none w-56 rounded-xl px-3 py-2 text-xs">
            <div className="font-semibold text-ink-1">{s.name}</div>
            <div className="mt-0.5 text-ink-3">
              {s.city} · {s.country} · {s.commodity}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS[light].color }} />
              <span className="text-ink-2">
                {STATUS[light].label} · Score <b className="text-ink-1">{s.score}</b>
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 text-ink-3">
              <span>Customer-Share</span>
              <span className="text-right text-ink-2">{fmt(s.customer_share)} %</span>
              <span>PD (Coface)</span>
              <span className="text-right text-ink-2">{fmt(s.pd, 2)} %</span>
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

/** Material flow from supplier to plant: a curved line with a travelling particle. */
export function FlowLine({ x, z, light, dimmed }: { x: number; z: number; light: Light; dimmed: boolean }) {
  const particle = useRef<THREE.Mesh>(null)
  const start = useMemo(() => new THREE.Vector3(x, 0.25, z), [x, z])
  const end = useMemo(() => {
    const v = new THREE.Vector3(x, 0, z).normalize().multiplyScalar(8.4)
    v.y = 0.25
    return v
  }, [x, z])
  const mid = useMemo(() => start.clone().lerp(end, 0.5).setY(start.distanceTo(end) * 0.28), [start, end])
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(start, mid, end), [start, mid, end])
  const offset = useMemo(() => Math.random(), [])
  const speed = light === 'red' ? 0.12 : 0.22

  useFrame(({ clock }) => {
    if (!particle.current) return
    const t = (clock.getElapsedTime() * speed + offset) % 1
    particle.current.position.copy(curve.getPoint(t))
  })

  const color = GLOW[light]
  return (
    <group>
      <QuadraticBezierLine
        start={start}
        end={end}
        mid={mid}
        color={color}
        lineWidth={1.2}
        transparent
        opacity={dimmed ? 0.05 : 0.35}
        dashed
        dashScale={2}
        dashSize={0.6}
        gapSize={0.4}
      />
      {!dimmed && (
        <mesh ref={particle}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
    </group>
  )
}
