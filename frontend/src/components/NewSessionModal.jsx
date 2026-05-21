import { useState, useEffect } from 'react'

const DEFAULT_MSG =
  'Hola [Nombre], ¿cómo estás? Nos contactamos desde Silko para consultarte sobre tu reciente compra.'

function todayStr() { return new Date().toISOString().split('T')[0] }
function weekAgoStr() {
  const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]
}

export default function NewSessionModal({ source = 'gm', onClose, onCreated }) {
  const isTN = source === 'tn'

  const [channels, setChannels] = useState([])
  const [stores, setStores] = useState([])
  const [loadingOpts, setLoadingOpts] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const [form, setForm] = useState({
    name: '',
    channel_id: '',
    store_id: '',
    date_from: weekAgoStr(),
    date_to: todayStr(),
    whatsapp_message: DEFAULT_MSG,
  })

  useEffect(() => {
    if (isTN) return
    setLoadingOpts(true)
    fetch('/api/channels-stores')
      .then(r => r.json())
      .then(d => { setChannels(d.channels || []); setStores(d.stores || []) })
      .catch(() => {})
      .finally(() => setLoadingOpts(false))
  }, [isTN])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('El nombre de la sesión es requerido.')
    setCreating(true); setError(null)
    try {
      const endpoint = isTN ? '/api/tn/sessions' : '/api/sessions'
      const body = isTN
        ? { name: form.name, date_from: form.date_from, date_to: form.date_to, whatsapp_message: form.whatsapp_message }
        : { ...form, channel_id: form.channel_id ? +form.channel_id : null, store_id: form.store_id ? +form.store_id : null }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al crear la sesión')
      onCreated(data)
    } catch (err) {
      setError(err.message)
      setCreating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => !creating && e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title-area">
            <h2>Nueva sesión de PostVenta</h2>
            <span className={`modal-source-badge ${isTN ? 'badge-tn' : 'badge-gm'}`}>
              {isTN ? 'Tienda Nube' : 'Gestion Moda'}
            </span>
          </div>
          {!creating && <button className="modal-close-btn" onClick={onClose}>×</button>}
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="name">Nombre de la sesión *</label>
            <input
              id="name" type="text"
              placeholder={isTN ? 'Ej: PostVenta Tienda Nube — Mayo' : 'Ej: PostVenta Mayo — Local Florida'}
              value={form.name} onChange={e => set('name', e.target.value)}
              disabled={creating} required
            />
          </div>

          {!isTN && (
            <div className="form-row">
              <div className="form-group">
                <label>Canal de venta</label>
                <select value={form.channel_id} onChange={e => set('channel_id', e.target.value)} disabled={loadingOpts || creating}>
                  <option value="">Todos los canales</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Tienda / Local</label>
                <select value={form.store_id} onChange={e => set('store_id', e.target.value)} disabled={loadingOpts || creating}>
                  <option value="">Todas las tiendas</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="date_from">Fecha desde *</label>
              <input id="date_from" type="date" value={form.date_from} onChange={e => set('date_from', e.target.value)} disabled={creating} required />
            </div>
            <div className="form-group">
              <label htmlFor="date_to">Fecha hasta *</label>
              <input id="date_to" type="date" value={form.date_to} onChange={e => set('date_to', e.target.value)} disabled={creating} required />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="wsp_msg">Mensaje de WhatsApp</label>
            <textarea id="wsp_msg" rows={4} value={form.whatsapp_message}
              onChange={e => set('whatsapp_message', e.target.value)} disabled={creating} />
            <small className="form-hint">Usá <code>[Nombre]</code> para el primer nombre del cliente.</small>
          </div>

          {error && <div className="form-error">{error}</div>}

          {creating && (
            <div className="creating-status">
              <div className="spinner spinner-sm" />
              <span>Obteniendo {isTN ? 'órdenes de Tienda Nube' : 'ventas de Gestion Moda'}… puede tardar unos segundos.</span>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={creating}>Cancelar</button>
            <button type="submit" className={`btn ${isTN ? 'btn-tn' : 'btn-primary'}`} disabled={creating}>
              {creating ? 'Creando...' : 'Crear sesión'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
