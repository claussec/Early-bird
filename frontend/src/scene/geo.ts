/**
 * Map projection and country geometry for the 3D map (world-atlas 50m, Natural Earth data).
 * Equirectangular projection around the centre of all plants and suppliers, scaled so the
 * network fills the view; x = east, z = south.
 */
import * as THREE from 'three'
import { feature, mesh } from 'topojson-client'
import type { GeometryObject, Topology } from 'topojson-specification'

export interface Projection {
  project(lat: number, lon: number): [number, number]
  /** Scene units per degree of latitude. */
  k: number
  /** Visible extent in degrees, with margin (for clipping the country geometry). */
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }
}

const TARGET_SPAN = 72

export function makeProjection(points: { lat: number; lon: number }[]): Projection {
  const pts = points.length ? points : [{ lat: 50, lon: 10 }]
  const lats = pts.map((p) => p.lat)
  const lons = pts.map((p) => p.lon)
  let [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)]
  const lat0 = (minLat + maxLat) / 2
  const lon0 = (minLon + maxLon) / 2
  const cos = Math.cos((lat0 * Math.PI) / 180)
  // At least ~6° across so a single city does not fill the whole screen.
  const span = Math.max((maxLon - minLon) * cos, maxLat - minLat, 6)
  const k = TARGET_SPAN / span
  const margin = span * 0.9 + 4
  minLat -= margin
  maxLat += margin
  minLon -= margin / cos
  maxLon += margin / cos
  return {
    k,
    bounds: { minLat, maxLat, minLon, maxLon },
    project: (lat, lon) => [(lon - lon0) * cos * k, -(lat - lat0) * k],
  }
}

type Ring = [number, number][]

function ringInBounds(ring: Ring, b: Projection['bounds']) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const [lon, lat] of ring) {
    if (lon < x0) x0 = lon
    if (lon > x1) x1 = lon
    if (lat < y0) y0 = lat
    if (lat > y1) y1 = lat
  }
  return x1 >= b.minLon && x0 <= b.maxLon && y1 >= b.minLat && y0 <= b.maxLat
}

export interface CountryGeometry {
  land: THREE.BufferGeometry
  coast: THREE.BufferGeometry
  borders: THREE.BufferGeometry
}

let topology: Topology | null = null

export async function loadWorld(): Promise<Topology> {
  topology ??= (await import('world-atlas/countries-50m.json')).default as unknown as Topology
  return topology
}

/** Land polygons (flat, on y = 0) plus coastlines and borders as line segments, clipped to the view. */
export function buildCountries(world: Topology, proj: Projection): CountryGeometry {
  const countries = world.objects.countries as GeometryObject
  const fc = feature(world, countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  const shapes: THREE.Shape[] = []
  for (const f of fc.features) {
    if (!f.geometry) continue
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const poly of polys) {
      const [outer, ...holes] = poly as Ring[]
      if (!ringInBounds(outer, proj.bounds)) continue
      // Shape lives in the x/y plane; y = -z so the mesh can be rotated flat onto the ground.
      const toVec = ([lon, lat]: [number, number]) => {
        const [x, z] = proj.project(lat, lon)
        return new THREE.Vector2(x, -z)
      }
      const shape = new THREE.Shape(outer.map(toVec))
      holes.forEach((h) => shape.holes.push(new THREE.Path(h.map(toVec))))
      shapes.push(shape)
    }
  }
  const land = new THREE.ShapeGeometry(shapes, 1)
  land.rotateX(-Math.PI / 2)

  const lines = (filter: (a: GeometryObject, b: GeometryObject) => boolean) => {
    const ml = mesh(world, countries, filter) as unknown as GeoJSON.MultiLineString
    const pts: number[] = []
    for (const line of ml.coordinates as Ring[]) {
      for (let i = 1; i < line.length; i++) {
        const [lon0, lat0] = line[i - 1]
        const [lon1, lat1] = line[i]
        const b = proj.bounds
        if ((lon0 < b.minLon && lon1 < b.minLon) || (lon0 > b.maxLon && lon1 > b.maxLon)) continue
        if ((lat0 < b.minLat && lat1 < b.minLat) || (lat0 > b.maxLat && lat1 > b.maxLat)) continue
        if (Math.abs(lon1 - lon0) > 90) continue // antimeridian
        const [x0, z0] = proj.project(lat0, lon0)
        const [x1, z1] = proj.project(lat1, lon1)
        pts.push(x0, 0, z0, x1, 0, z1)
      }
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  }
  return { land, coast: lines((a, b) => a === b), borders: lines((a, b) => a !== b) }
}

/** Spreads markers that would overlap (same city) on a small spiral around their location. */
export function spread<T extends { id: string; x: number; z: number }>(items: T[], minDist: number): T[] {
  const placed: T[] = []
  for (const it of items) {
    let { x, z } = it
    for (let n = 1; placed.some((p) => Math.hypot(p.x - x, p.z - z) < minDist) && n < 40; n++) {
      const angle = n * 2.4
      const r = minDist * 0.6 * Math.sqrt(n)
      x = it.x + Math.cos(angle) * r
      z = it.z + Math.sin(angle) * r
    }
    placed.push({ ...it, x, z })
  }
  return placed
}
