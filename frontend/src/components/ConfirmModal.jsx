// Modal de confirmación genérico, para acciones destructivas.
// Reemplaza a window.confirm: el diálogo del navegador es fácil de aceptar sin
// leer y no permite destacar que la acción es irreversible.
import { AlertTriangle } from 'lucide-react'

export default function ConfirmModal({
  title,
  message,
  detail,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal confirm-modal">
        <div className="modal-header">
          <div className="modal-title-area">
            <h2>{title}</h2>
          </div>
          {!busy && <button className="modal-close-btn" onClick={onCancel}>×</button>}
        </div>

        <div className="modal-form">
          <p className="confirm-message">{message}</p>
          {detail && <p className="confirm-detail">{detail}</p>}
          {danger && (
            <p className="confirm-warning"><AlertTriangle size={15} /> Esta acción no se puede revertir.</p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? 'Procesando...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
