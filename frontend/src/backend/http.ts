/** Server variant: the FastAPI backend (see backend/app/main.py). */
import type { Automode, Channel, Lang, Meta, Notification, Plant, StreamEvent, Supplier, SupplierDetail, SupplierInput } from '../types'
import type { Backend } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    const detail = body?.detail
    throw new Error(
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { loc: string[]; msg: string }) => `${d.loc.slice(1).join('.')}: ${d.msg}`).join('; ')
          : `${r.status} ${r.statusText}`,
    )
  }
  return r.status === 204 ? (undefined as T) : r.json()
}

const get = <T>(path: string) => request<T>(path)
const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

/** POSTs to a server-sent-events endpoint and calls onEvent for every event. */
async function stream(path: string, onEvent: (e: StreamEvent) => void): Promise<void> {
  const r = await fetch(path, { method: 'POST' })
  if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText}`)
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '))
      if (line) onEvent(JSON.parse(line.slice(6)))
    }
  }
}

let lang: Lang = 'de'
const withLang = (path: string) => `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`

export const httpBackend: Backend = {
  target: 'server',
  setLang(l) {
    lang = l
  },
  meta: () => get<Meta>('/api/meta'),
  suppliers: () => get<Supplier[]>('/api/suppliers'),
  supplier: (id) => get<SupplierDetail>(`/api/suppliers/${id}`),
  notifications: () => get<Notification[]>('/api/notifications'),
  createSupplier: (input: SupplierInput) => send<Supplier>('POST', withLang('/api/suppliers'), input),
  updateSupplier: (id, input) => send<Supplier>('PUT', withLang(`/api/suppliers/${id}`), input),
  deleteSupplier: (id) => send<void>('DELETE', `/api/suppliers/${id}`),
  plants: () => get<Plant[]>('/api/plants'),
  createPlant: (input) => send<Plant>('POST', '/api/plants', input),
  updatePlant: (id, input) => send<Plant>('PUT', `/api/plants/${id}`, input),
  deletePlant: (id) => send<void>('DELETE', `/api/plants/${id}`),
  analyze: (id, onEvent) => stream(withLang(`/api/suppliers/${id}/analyze`), onEvent),
  cycle: (onEvent) => stream(withLang('/api/cycle'), onEvent),
  automode: {
    channels: () => get<Channel[]>('/api/channels'),
    get: () => get<Automode>('/api/automode'),
    set: (changes) => send<Automode>('PUT', '/api/automode', changes),
    run: () => send<{ started: boolean }>('POST', '/api/automode/run'),
  },
}
