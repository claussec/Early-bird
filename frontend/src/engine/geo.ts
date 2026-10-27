/**
 * Offline geocoding for the in-browser variants – port of the offline path of
 * backend/app/geo.py over the same gazetteer (data/gazetteer.json, GeoNames, CC BY 4.0).
 */
import type { GeoLocation } from '../types'

type Row = [string, string, number, number]

let byCity: Map<string, [number, number]> | null = null
let byCountry: Map<string, [number, number]> | null = null
let loading: Promise<void> | null = null

const norm = (s: string) =>
  (s || '')
    .normalize('NFKD')
    .replace(/[^ -~]/g, '') // drops the accents NFKD split off, and any other non-ASCII
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

/** Loads the gazetteer (bundled, ~0.4 MB). Call once before `geocode`. */
export function loadGazetteer(): Promise<void> {
  loading ??= import('../../../data/gazetteer.json').then((m) => {
    const rows = (m.default ?? m) as unknown as Row[]
    byCity = new Map()
    byCountry = new Map()
    for (const [name, country, lat, lon] of rows) {
      // Rows are sorted by population: the first hit is the largest place of that name.
      const key = `${norm(name)}|${country}`
      if (!byCity.has(key)) byCity.set(key, [lat, lon])
      if (!byCountry.has(country)) byCountry.set(country, [lat, lon])
    }
  })
  return loading
}

/** City (or, failing that, the country's largest city); null if neither is known or not loaded yet. */
export function geocode(city: string, country: string): GeoLocation | null {
  if (!byCity || !byCountry) return null
  const cc = (country || '').trim().toUpperCase()
  const name = norm(city)
  if (name) {
    let hit = byCity.get(`${name}|${cc}`)
    if (!hit && !cc) for (const [k, v] of byCity) if (k.startsWith(`${name}|`)) { hit = v; break }
    if (!hit) for (const [k, v] of byCity) if (k.endsWith(`|${cc}`) && k.startsWith(`${name} `)) { hit = v; break }
    if (hit) return { lat: hit[0], lon: hit[1], precision: 'city', source: 'gazetteer' }
  }
  const c = byCountry.get(cc)
  return c ? { lat: c[0], lon: c[1], precision: 'country', source: 'gazetteer' } : null
}

/** Manual coordinates win; otherwise the address is geocoded. */
export function locate(a: { city: string; country: string }, lat?: number | null, lon?: number | null): GeoLocation | null {
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) return { lat, lon, precision: 'manual', source: 'manual' }
  return geocode(a.city, a.country)
}
