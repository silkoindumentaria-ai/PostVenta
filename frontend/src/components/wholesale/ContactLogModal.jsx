// Registrar (o editar) un contacto con un mayorista.
// Sigue el patrón de NewSessionModal: un objeto `form` con setter genérico,
// estados saving/error y validación con early return.
import { useState } from 'react'
import { todayStr, addDays, formatDate } from '../../utils/format.js'

const OUTCOMES = [
  { value: '', label: 'Sin especificar' },
  { value: 'compro', label: 'Compró' },
  { value: 'va_a_comprar', label: 'Va a comprar' },
  { value: 'pidio_info', label: 'Pidió info / precios' },
  { value: 'no_contesta', label: 'No contesta' },
  { value: 'no_interesa', label: 'No le interesa por ahora' },
]

const QUICK_DAYS = [7, 15, 30]

export default function ContactLogModal({ client, sellers, contact, onClose, onSaved }) {
  const editing = !!contact

  const [form, setForm] = useState({
    contacted_at: contact?.contacted_at || todayStr(),
    outcome: contact?.outcome || '',
    note: contact?.note || '',
    seller: contact?.seller || client.assigned_to || '',
    next_contact_date: contact?.next_contact_date || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.contacted_at) return setError('La fecha del contacto es requerida.')
    if (form.next_contact_date && form.next_contact_date < form.contacted_at) {
      return setError('El próximo contacto no puede ser anterior a la fecha del contacto.')
    }

    setSaving(true)
    setError(null)
    try {
      const url = editing
        ? `/api/wholesale/contacts/${contact.id}`
        : `/api/wholesale/clients/${client.id}/contacts`
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar el contacto.')
      onSaved(data)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title-area">
            <h2>{editing ? 'Editar contacto' : 'Registrar contacto'}</h2>
            <span className="modal-history-name">{client.name}</span>
          </div>
          {!saving && <button className="modal-close-btn" onClick={onClose}>×</button>}
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="wh-date">Fecha del contacto</label>
              <input
                id="wh-date"
                type="date"
                value={form.contacted_at}
                onChange={e => set('contacted_at', e.target.value)}
                disabled={saving}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="wh-outcome">Resultado</label>
              <select
                id="wh-outcome"
                value={form.outcome}
                onChange={e => set('outcome', e.target.value)}
                disabled={saving}
              >
                {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="wh-note">¿Qué dijo el cliente?</label>
            <textarea
              id="wh-note"
              rows={4}
              placeholder="Ej: pidió lista de precios actualizada, va a hacer pedido cuando cobre el día 10..."
              value={form.note}
              onChange={e => set('note', e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="form-group">
            <label htmlFor="wh-seller">Vendedor</label>
            {sellers.length > 0 ? (
              <select
                id="wh-seller"
                value={form.seller}
                onChange={e => set('seller', e.target.value)}
                disabled={saving}
              >
                <option value="">Sin especificar</option>
                {sellers.map(s => <option key={s} value={s}>{s}</option>)}
                {/* Si el contacto tenía un vendedor que ya no está en la lista, no se pierde. */}
                {form.seller && !sellers.includes(form.seller) && (
                  <option value={form.seller}>{form.seller}</option>
                )}
              </select>
            ) : (
              <>
                <input
                  id="wh-seller"
                  type="text"
                  value={form.seller}
                  onChange={e => set('seller', e.target.value)}
                  disabled={saving}
                  placeholder="Nombre del vendedor"
                />
                <small className="form-hint">
                  Cargá la lista del equipo en Configuración para elegirlo de un desplegable.
                </small>
              </>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="wh-next">Próximo contacto</label>
            <div className="wh-quick-dates">
              {QUICK_DAYS.map(d => {
                const value = addDays(form.contacted_at || todayStr(), d)
                return (
                  <button
                    key={d}
                    type="button"
                    className={`filter-pill ${form.next_contact_date === value ? 'active' : ''}`}
                    onClick={() => set('next_contact_date', value)}
                    disabled={saving}
                    title={formatDate(value)}
                  >
                    +{d}d
                  </button>
                )
              })}
              <button
                type="button"
                className={`filter-pill ${!form.next_contact_date ? 'active' : ''}`}
                onClick={() => set('next_contact_date', '')}
                disabled={saving}
              >
                Sin fecha
              </button>
            </div>
            <input
              id="wh-next"
              type="date"
              value={form.next_contact_date}
              onChange={e => set('next_contact_date', e.target.value)}
              disabled={saving}
            />
            <small className="form-hint">
              Los clientes con el próximo contacto vencido o de hoy aparecen arriba de todo, en la agenda.
            </small>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Registrar contacto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
