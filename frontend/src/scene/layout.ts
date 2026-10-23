import type { Supplier } from '../types'

export interface Placement {
  x: number
  z: number
}

export const SECTOR_RADIUS = 31

/** Places suppliers in pie sectors (one per commodity) around the plant. */
export function layoutSuppliers(suppliers: Supplier[], commodities: string[]) {
  const positions: Record<string, Placement> = {}
  const sectors = commodities.map((c, i) => {
    const span = (Math.PI * 2) / commodities.length
    const center = i * span - Math.PI / 2
    const members = suppliers.filter((s) => s.commodity === c).sort((a, b) => a.id.localeCompare(b.id))
    members.forEach((s, j) => {
      const ring = j % 2 === 0 ? 15 : 23
      const slots = Math.ceil(members.length / 2)
      const slot = Math.floor(j / 2)
      const offset = slots === 1 ? 0 : (slot / (slots - 1) - 0.5) * span * 0.55
      const angle = center + offset + (j % 2 === 0 ? -0.06 : 0.12)
      positions[s.id] = { x: Math.cos(angle) * ring, z: Math.sin(angle) * ring }
    })
    return { name: c, center, start: center - span / 2 }
  })
  return { positions, sectors }
}
