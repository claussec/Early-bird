/** The buying organization's plants: address, contacts for early warnings, linked suppliers. */
import { ArrowLeft, Factory, Loader2, MapPin, Pencil, Plus, Save, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { backend } from '../backend'
import { useI18n } from '../i18n'
import type { Contact, Plant } from '../types'
import { addressLine } from './DetailPanel'
import { AddressFields, Field, addressFrom, addressInput, inputClass, type AddressState } from './SupplierForm'

interface Props {
  plants: Plant[]
  onChanged: () => Promise<void> | void
  onClose: () => void
}

export function PlantManager({ plants, onChanged, onClose }: Props) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<Plant | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (id: string) => {
    try {
      await backend.deletePlant(id)
      setConfirm(null)
      await onChanged()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm md:p-8">
      <div className="glass my-auto w-full max-w-2xl rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-start gap-2">
            {editing && (
              <button onClick={() => setEditing(null)} className="mt-0.5 rounded-lg p-1 text-ink-3 hover:bg-white/5 hover:text-ink-1">
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <h2 className="text-base font-semibold text-ink-1">
                {editing === 'new' ? t('plants.form.create') : editing ? t('plants.form.edit') : t('plants.title')}
              </h2>
              {!editing && <p className="mt-0.5 text-xs text-ink-3">{t('plants.subtitle')}</p>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        {editing ? (
          <PlantForm
            plant={editing === 'new' ? undefined : editing}
            onSaved={async () => {
              setEditing(null)
              await onChanged()
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="space-y-2 px-5 py-4">
            {plants.map((p) => (
              <div key={p.id} className="rounded-xl border border-line bg-surface-0/50 p-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15">
                    <Factory size={16} className="text-accent" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink-1">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
                      <MapPin size={11} /> {addressLine(p) || t('plants.not_located')}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink-3">
                      <span>{t('plants.suppliers', { n: p.supplier_ids?.length ?? 0 })}</span>
                      <span className="flex items-center gap-1">
                        <Users size={11} /> {t('plants.contacts', { n: p.contacts.length })}
                        {p.contacts.length > 0 && <span className="text-ink-2">· {p.contacts.map((c) => c.name || c.email).join(', ')}</span>}
                      </span>
                    </div>
                  </div>
                  {confirm === p.id ? (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="max-w-[180px] text-right text-[11px] text-ink-3">{t('plants.delete_confirm')}</span>
                      <div className="flex gap-1">
                        <button onClick={() => remove(p.id)} className="rounded-lg bg-crit/20 px-2 py-1 text-xs font-medium text-[#ff8a8a]">
                          {t('common.delete')}
                        </button>
                        <button onClick={() => setConfirm(null)} className="px-1.5 py-1 text-xs text-ink-3 hover:text-ink-1">
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => setEditing(p)}
                        className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-ink-1"
                        aria-label={t('common.edit')}
                        title={t('common.edit')}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setConfirm(p.id)}
                        className="rounded-lg p-1.5 text-ink-3 hover:bg-white/5 hover:text-[#ff8a8a]"
                        aria-label={t('common.delete')}
                        title={t('common.delete')}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!plants.length && <p className="py-4 text-center text-xs text-ink-3">{t('plants.empty')}</p>}
            {error && <p className="text-xs text-[#ff8a8a]">{error}</p>}
            <button
              onClick={() => setEditing('new')}
              className="mt-2 flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              <Plus size={16} /> {t('plants.add')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PlantForm({ plant, onSaved, onCancel }: { plant?: Plant; onSaved: () => void; onCancel: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(plant?.name ?? '')
  const [address, setAddress] = useState<AddressState>(() => addressFrom(plant))
  const [contacts, setContacts] = useState<Contact[]>(plant?.contacts.length ? plant.contacts : [{ name: '', email: '', role: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setContact = (i: number, k: keyof Contact, v: string) => setContacts(contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const input = {
      name: name.trim(),
      ...addressInput(address),
      contacts: contacts.filter((c) => c.name.trim() || c.email.trim()).map((c) => ({ ...c, name: c.name.trim() || c.email.trim() })),
    }
    try {
      if (plant) await backend.updatePlant(plant.id, input)
      else await backend.createPlant(input)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="space-y-5 px-5 py-4">
        <Field label={t('plants.name')}>
          <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder={t('plants.name.ph')} />
        </Field>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{t('plants.address')}</h3>
          <AddressFields value={address} onChange={setAddress} manual={plant?.location?.precision === 'manual'} />
        </section>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{t('plants.contacts_title')}</h3>
          <div className="space-y-2">
            {contacts.map((c, i) => (
              <div key={i} className="grid grid-cols-12 items-end gap-2">
                <Field label={i === 0 ? t('plants.contact_name') : ''} className="col-span-12 sm:col-span-4">
                  <input value={c.name} onChange={(e) => setContact(i, 'name', e.target.value)} className={inputClass} />
                </Field>
                <Field label={i === 0 ? t('plants.contact_email') : ''} className="col-span-7 sm:col-span-4">
                  <input type="email" value={c.email} onChange={(e) => setContact(i, 'email', e.target.value)} className={inputClass} />
                </Field>
                <Field label={i === 0 ? t('plants.contact_role') : ''} className="col-span-4 sm:col-span-3">
                  <input
                    value={c.role}
                    onChange={(e) => setContact(i, 'role', e.target.value)}
                    className={inputClass}
                    placeholder={t('plants.contact_role.ph')}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => setContacts(contacts.filter((_, j) => j !== i))}
                  className="col-span-1 mb-1.5 justify-self-center rounded-lg p-1.5 text-ink-3 hover:text-[#ff8a8a]"
                  aria-label={t('plants.contact_remove')}
                  title={t('plants.contact_remove')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setContacts([...contacts, { name: '', email: '', role: '' }])}
            className="mt-2 flex items-center gap-1.5 text-xs text-accent hover:underline"
          >
            <UserPlus size={13} /> {t('plants.contact_add')}
          </button>
        </section>
        {error && <div className="rounded-xl border border-crit/50 bg-crit/10 px-3 py-2 text-sm text-[#ff8a8a]">{error}</div>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-sm text-ink-2 hover:bg-white/5">
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          {t('common.save')}
        </button>
      </footer>
    </form>
  )
}
