import type { Meta, Notification, StreamEvent, Supplier, SupplierDetail } from './types'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
}

export const api = {
  meta: () => get<Meta>('/api/meta'),
  suppliers: () => get<Supplier[]>('/api/suppliers'),
  supplier: (id: string) => get<SupplierDetail>(`/api/suppliers/${id}`),
  notifications: () => get<Notification[]>('/api/notifications'),
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
