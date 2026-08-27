import { useState, useEffect } from 'react'
import { formatDateTime } from '../utils/format.js'

export default function HistoryModal({ contactId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/contacts/${contactId}/history`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('No se pudo cargar el historial.'))
      .finally(() => setLoading(false))
  }, [contactId])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title-area">
            <h2>Historial de contacto</h2>
            {data && <span className="modal-history-name">{data.client_name}</span>}
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-form">
          {loading && <p>Cargando...</p>}
          {error && <div className="form-error">{error}</div>}
          {data && data.entries.length === 0 && (
            <p className="history-empty">Todavía no se registraron contactos para este cliente.</p>
          )}
          {data && data.entries.map(e => (
            <div key={e.id} className="history-entry">
              <div className="history-entry-meta">
                <span className={`badge ${e.source === 'tn' ? 'badge-tn' : 'badge-gm'}`}>
                  {e.source === 'tn' ? 'Tienda Nube' : 'Gestion Moda'} — {e.session_name}
                </span>
                <span className="history-entry-date">{formatDateTime(e.contacted_at)}</span>
              </div>
              <p className="history-entry-message">"{e.message || '(sin mensaje registrado)'}"</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
