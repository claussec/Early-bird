import { Edges, Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'

/** The buying organization's plant in the center of the supplier network. */
export function Plant() {
  const ring = useRef<Mesh>(null)
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.15
  })
  const teeth = [-3.75, -1.25, 1.25, 3.75]
  return (
    <group>
      {/* platform */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <cylinderGeometry args={[8.2, 8.6, 0.1, 64]} />
        <meshStandardMaterial color="#10151d" metalness={0.4} roughness={0.6} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
        <ringGeometry args={[8.0, 8.15, 96, 1, 0, Math.PI * 1.6]} />
        <meshBasicMaterial color="#3987e5" toneMapped={false} />
      </mesh>

      {/* main hall */}
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[10, 3, 6.5]} />
        <meshStandardMaterial color="#1b2330" metalness={0.55} roughness={0.35} />
        <Edges color="#3987e5" threshold={15} />
      </mesh>
      {/* window band */}
      <mesh position={[0, 1.9, 3.26]}>
        <planeGeometry args={[9.2, 0.35]} />
        <meshBasicMaterial color="#9ec5f4" toneMapped={false} />
      </mesh>
      {/* sawtooth roof */}
      {teeth.map((x) => (
        <group key={x} position={[x, 3.1, 0]}>
          <mesh rotation={[0, 0, Math.PI / 5]} position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[2.5, 0.12, 6.5]} />
            <meshStandardMaterial color="#232d3c" metalness={0.5} roughness={0.4} />
          </mesh>
          <mesh position={[0.7, 0.55, 0]}>
            <boxGeometry args={[0.06, 1.1, 6.4]} />
            <meshBasicMaterial color="#cde2fb" toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* office tower */}
      <mesh position={[-3.6, 3.4, -1.8]} castShadow>
        <boxGeometry args={[2.4, 6.6, 2.4]} />
        <meshStandardMaterial color="#18202c" metalness={0.6} roughness={0.3} />
        <Edges color="#5598e7" threshold={15} />
      </mesh>
      {[1.5, 2.5, 3.5, 4.5, 5.5].map((y) => (
        <mesh key={y} position={[-3.6, y + 0.4, -0.59]}>
          <planeGeometry args={[2.0, 0.18]} />
          <meshBasicMaterial color="#86b6ef" toneMapped={false} />
        </mesh>
      ))}
      {/* chimneys */}
      {[2.8, 4.0].map((x) => (
        <mesh key={x} position={[x, 4.2, -2.2]} castShadow>
          <cylinderGeometry args={[0.28, 0.35, 5, 16]} />
          <meshStandardMaterial color="#2a3442" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <Html position={[0, 7.8, 0]} center distanceFactor={38} zIndexRange={[10, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[13px] font-semibold tracking-wide text-ink-1">
          Werk · Abnehmer
        </div>
      </Html>
    </group>
  )
}
