// Alta de un mayorista: buscador sobre el padrón de Gestion Moda (tabla
// gm_clients, ya sincronizada) o carga manual para los que no existen en GM.
import { useState, useEffect } from 'react'

export default function AddWholesaleModal({ sellers, onClose, onCreated }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [manual, setManual] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', assigned_to: '', tags: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Búsqueda con debounce: el padrón tiene ~27.500 clientes.
  useEffect(() => {
    if (manual) return
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }

    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/wholesale/clients/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(res.ok ? data.results : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, manual])

  const create = async body => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/wholesale/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo agregar el mayorista.')
      onCreated(data)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const handleManualSubmit = e => {
    e.preventDefault()
    if (!form.name.trim()) return setError('El nombre es requerido.')
    create({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      assigned_to: form.assigned_to,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    })
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title-area">
            <h2>Agregar mayorista</h2>
          </div>
          {!saving && <button className="modal-close-btn" onClick={onClose}>×</button>}
        </div>

        {!manual ? (
          <div className="modal-form">
            <div className="form-group">
              <label htmlFor="wh-search">Buscar en el padrón de Gestion Moda</label>
              <input
                id="wh-search"
                type="text"
                placeholder="Nombre o teléfono del cliente..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={saving}
                autoFocus
              />
              <small className="form-hint">
                Al vincularlo con GM se traen automáticamente sus ventas y unidades compradas.
              </small>
            </div>

            {error && <div className="form-error">{error}</div>}

            <div className="wh-search-results">
              {searching && <p className="wh-muted">Buscando...</p>}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <p className="wh-muted">
                  Sin resultados. En Gestion Moda el mismo apellido puede estar cargado con y sin
                  ñ/acentos, así que probá las dos formas ("MUÑOZ" y "MUNOZ" dan resultados distintos).
                  También podés buscar por teléfono, desde 4 dígitos.
                </p>
              )}
              {results.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className="wh-result"
                  disabled={r.already_added || saving}
                  onClick={() => create({ gm_client_id: r.id })}
                >
                  <span className="wh-result-name">{r.name || '(sin nombre)'}</span>
                  <span className="wh-result-phone">{r.phone || 'sin teléfono'}</span>
                  {r.already_added && <span className="wh-result-tag">ya cargado</span>}
                </button>
              ))}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setManual(true); setError(null) }} disabled={saving}>
                Cargar manualmente
              </button>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleManualSubmit} className="modal-form">
            <div className="form-group">
              <label htmlFor="wh-name">Nombre *</label>
              <input id="wh-name" type="text" value={form.name}
                onChange={e => set('name', e.target.value)} disabled={saving} required autoFocus />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="wh-phone">Teléfono</label>
                <input id="wh-phone" type="text" placeholder="3515931246" value={form.phone}
                  onChange={e => set('phone', e.target.value)} disabled={saving} />
              </div>
              <div className="form-group">
                <label htmlFor="wh-email">Email</label>
                <input id="wh-email" type="email" value={form.email}
                  onChange={e => set('email', e.target.value)} disabled={saving} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="wh-assigned">Vendedor asignado</label>
                {sellers.length > 0 ? (
                  <select id="wh-assigned" value={form.assigned_to}
                    onChange={e => set('assigned_to', e.target.value)} disabled={saving}>
                    <option value="">Sin asignar</option>
                    {sellers.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input id="wh-assigned" type="text" value={form.assigned_to}
                    onChange={e => set('assigned_to', e.target.value)} disabled={saving} />
                )}
              </div>
              <div className="form-group">
                <label htmlFor="wh-tags">Etiquetas</label>
                <input id="wh-tags" type="text" placeholder="Zona Norte, VIP" value={form.tags}
                  onChange={e => set('tags', e.target.value)} disabled={saving} />
                <small className="form-hint">Separadas por coma</small>
              </div>
            </div>

            <small className="form-hint">
              Un cliente cargado a mano no se vincula con Gestion Moda: no va a mostrar ventas ni unidades.
            </small>

            {error && <div className="form-error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setManual(false); setError(null) }} disabled={saving}>
                Volver al buscador
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Agregando...' : 'Agregar mayorista'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
