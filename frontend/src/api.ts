import type { Automode, Channel, Meta, Notification, StreamEvent, Supplier, SupplierDetail, SupplierInput } from './types'

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

const get = <T,>(path: string) => request<T>(path)
const send = <T,>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  meta: () => get<Meta>('/api/meta'),
  suppliers: () => get<Supplier[]>('/api/suppliers'),
  supplier: (id: string) => get<SupplierDetail>(`/api/suppliers/${id}`),
  notifications: () => get<Notification[]>('/api/notifications'),
  createSupplier: (input: SupplierInput) => send<Supplier>('POST', '/api/suppliers', input),
  deleteSupplier: (id: string) => send<void>('DELETE', `/api/suppliers/${id}`),
  channels: () => get<Channel[]>('/api/channels'),
  automode: () => get<Automode>('/api/automode'),
  setAutomode: (changes: Partial<Pick<Automode, 'enabled' | 'interval_minutes' | 'channels'>>) =>
    send<Automode>('PUT', '/api/automode', changes),
  runAutomode: () => send<{ started: boolean }>('POST', '/api/automode/run'),
}

/** POSTs to a server-sent-events endpoint and calls onEvent for every event. */
export async function stream(path: string, onEvent: (e: StreamEvent) => void): Promise<void> {
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
