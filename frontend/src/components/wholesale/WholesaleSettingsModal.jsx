// Configuración del módulo: umbrales del semáforo de inactividad, meses de
// histórico a sincronizar y lista de vendedores del equipo.
import { useState } from 'react'

export default function WholesaleSettingsModal({ settings, onClose, onSaved }) {
  const [form, setForm] = useState({
    warn_days: settings.warn_days ?? 30,
    alert_days: settings.alert_days ?? 60,
    history_months: settings.history_months ?? 12,
  })
  const [sellers, setSellers] = useState(settings.sellers || [])
  const [newSeller, setNewSeller] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const addSeller = () => {
    const name = newSeller.trim()
    if (!name || sellers.includes(name)) return
    setSellers([...sellers, name])
    setNewSeller('')
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (Number(form.alert_days) <= Number(form.warn_days)) {
      return setError('El umbral rojo debe ser mayor al ámbar.')
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/wholesale/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, sellers }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la configuración.')
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
            <h2>Configuración de mayoristas</h2>
          </div>
          {!saving && <button className="modal-close-btn" onClick={onClose}>×</button>}
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="wh-warn">Ámbar a partir de (días sin comprar)</label>
              <input id="wh-warn" type="number" min="1" value={form.warn_days}
                onChange={e => set('warn_days', e.target.value)} disabled={saving} required />
            </div>
            <div className="form-group">
              <label htmlFor="wh-alert">Rojo a partir de (días sin comprar)</label>
              <input id="wh-alert" type="number" min="2" value={form.alert_days}
                onChange={e => set('alert_days', e.target.value)} disabled={saving} required />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="wh-history">Meses de histórico a sincronizar</label>
            <input id="wh-history" type="number" min="1" max="60" value={form.history_months}
              onChange={e => set('history_months', e.target.value)} disabled={saving} required />
            <small className="form-hint">
              Cuántos meses de ventas se bajan de Gestion Moda al hacer el backfill. Más meses = primer
              sync más largo (el rate limit de GM es de 50 requests por minuto).
            </small>
          </div>

          <div className="form-group">
            <label>Vendedores del equipo</label>
            <div className="wh-sellers">
              {sellers.length === 0 && <span className="wh-muted">Todavía no cargaste ninguno.</span>}
              {sellers.map(s => (
                <span key={s} className="wh-tag wh-tag-removable">
                  {s}
                  <button type="button" onClick={() => setSellers(sellers.filter(x => x !== s))}
                    disabled={saving} title="Quitar">×</button>
                </span>
              ))}
            </div>
            <div className="wh-seller-add">
              <input
                type="text"
                placeholder="Nombre del vendedor"
                value={newSeller}
                onChange={e => setNewSeller(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSeller() } }}
                disabled={saving}
              />
              <button type="button" className="btn btn-secondary" onClick={addSeller} disabled={saving}>
                Agregar
              </button>
            </div>
            <small className="form-hint">
              Quitar un vendedor de la lista no borra los contactos que ya registró.
            </small>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
