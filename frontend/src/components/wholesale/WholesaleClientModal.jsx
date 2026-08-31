// Ficha completa de un mayorista: métricas, historial de ventas de GM y timeline
// de contactos. Permite editar los datos, actualizarlos contra GM, archivar y borrar.
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Pencil, Trash2, Archive, ArchiveRestore, Plus, Check, AlertTriangle } from 'lucide-react'
import ContactLogModal from './ContactLogModal.jsx'
import ConfirmModal from '../ConfirmModal.jsx'
import { WhatsAppIcon } from '../icons.jsx'
import { buildPlainWhatsAppUrl } from '../../utils/phone.js'
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js'
import { describeRefresh } from './refreshSummary.js'

const OUTCOME_LABEL = {
  compro: 'Compró',
  va_a_comprar: 'Va a comprar',
  pidio_info: 'Pidió info',
  no_contesta: 'No contesta',
  no_interesa: 'No le interesa',
}

export default function WholesaleClientModal({ clientId, onClose, onChanged, onArchive, onDelete, onRestore }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [logContact, setLogContact] = useState(null)   // contacto a editar
  const [showLog, setShowLog] = useState(false)
  const [confirm, setConfirm] = useState(null)         // { title, message, detail, onConfirm }
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/wholesale/clients/${clientId}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'No se pudo cargar la ficha.')
      setData(body)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const client = data?.client
  const archived = client?.status === 'archived'
  const m = client?.metrics || {}
  const sellers = data?.settings?.sellers || []

  const startEdit = () => {
    setForm({
      name: client.name || '',
      phone: client.phone || '',
      email: client.email || '',
      assigned_to: client.assigned_to || '',
      tags: (client.tags || []).join(', '),
      notes: client.notes || '',
    })
    setEditing(true)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const saveEdit = async e => {
    e.preventDefault()
    if (!form.name.trim()) return setError('El nombre no puede quedar vacío.')
    setSaving(true)
    try {
      const res = await fetch(`/api/wholesale/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'No se pudo guardar.')
      setEditing(false)
      setError(null)
      await load()
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Ejecuta la acción del ConfirmModal y cierra, propagando el error si falla.
  const runConfirmed = async action => {
    setConfirmBusy(true)
    try {
      await action()
      setConfirm(null)
    } catch (err) {
      setError(err.message)
      setConfirm(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  // Archivar y eliminar los maneja el panel, que es quien los ofrece también
  // desde el menú de la tarjeta: así el texto de confirmación es uno solo.
  const askDeleteContact = contact => setConfirm({
    title: 'Eliminar contacto',
    message: `¿Borrar el contacto del ${formatDate(contact.contacted_at)}?`,
    detail: contact.note ? `"${contact.note}"` : 'Este registro no tiene nota.',
    confirmLabel: 'Eliminar',
    danger: true,
    onConfirm: () => runConfirmed(async () => {
      const res = await fetch(`/api/wholesale/contacts/${contact.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error || 'No se pudo borrar el contacto.')
      await load()
      onChanged()
    }),
  })

  // Trae de GM el teléfono y las ventas al día de este cliente (~2 requests).
  const refresh = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch(`/api/wholesale/clients/${clientId}/refresh`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'No se pudo actualizar.')
      setRefreshMsg(describeRefresh(body.summary))
      await load()
      onChanged()
    } catch (err) {
      setRefreshMsg(null)
      setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }

  const afterLog = async () => {
    setShowLog(false)
    setLogContact(null)
    await load()
    onChanged()
  }

  const waUrl = client ? buildPlainWhatsAppUrl(client.phone) : null

  return (
    // El overlay no cierra: un clic al lado no puede tirar abajo lo que se estaba
    // editando. Se sale por la X, siempre.
    <div className="modal-overlay">
      <div className="modal wh-modal-wide">
        <div className="modal-header">
          <div className="modal-title-area">
            <h2>{client?.name || 'Ficha del mayorista'}</h2>
            {client?.phone && <span className="modal-history-name">{client.phone}</span>}
            {client?.email && <span className="modal-history-name">{client.email}</span>}
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-form">
          {loading && <p>Cargando...</p>}
          {error && <div className="form-error">{error}</div>}

          {client && !editing && (
            <>
              <div className="wh-detail-actions">
                {waUrl
                  ? (
                    <a href={waUrl} target="_blank" rel="noopener noreferrer" className="wsp-link">
                      <WhatsAppIcon size={16} /> WhatsApp
                    </a>
                  )
                  : <span className="wsp-disabled">Sin teléfono</span>}
                <button className="btn btn-primary" onClick={() => { setLogContact(null); setShowLog(true) }}>
                  <Plus size={15} /> Registrar contacto
                </button>
                {client.gm_client_id && (
                  <button className="btn btn-secondary" onClick={refresh} disabled={refreshing}
                    title="Trae de Gestion Moda el teléfono, el email y las ventas al día de este cliente">
                    <RefreshCw size={15} className={refreshing ? 'icon-spin' : ''} />
                    {refreshing ? 'Actualizando...' : 'Actualizar desde GM'}
                  </button>
                )}
                <button className="btn btn-secondary" onClick={startEdit}>
                  <Pencil size={15} /> Editar datos
                </button>
                {archived ? (
                  <button className="btn btn-primary" onClick={() => onRestore(client)}>
                    <ArchiveRestore size={15} /> Restaurar
                  </button>
                ) : (
                  <button className="btn btn-secondary" onClick={() => onArchive(client)}>
                    <Archive size={15} /> Archivar
                  </button>
                )}
                <button className="btn btn-danger" onClick={() => onDelete(client)}>
                  <Trash2 size={15} /> Eliminar
                </button>
              </div>

              {refreshMsg && (
                <div className="wh-refresh-msg">
                  {refreshMsg.changed && <Check size={13} />}
                  {refreshMsg.text}
                </div>
              )}

              {archived && (
                <div className="wh-banner wh-banner-muted">
                  <Archive size={15} />
                  Este mayorista está archivado: no aparece en el listado ni en la agenda.
                </div>
              )}

              <div className="wh-detail-meta">
                {client.assigned_to && <span className="badge badge-channel">{client.assigned_to}</span>}
                {(client.tags || []).map(t => <span key={t} className="wh-tag">{t}</span>)}
                {client.gm_client_id
                  ? <span className="badge badge-gm">GM #{client.gm_client_id}</span>
                  : <span className="badge badge-store">Carga manual</span>}
                {client.source === 'gm_auto' && <span className="badge badge-store">Importado por tipo</span>}
              </div>

              {client.gm_type_ok === false && (
                <div className="wh-banner">
                  <AlertTriangle size={15} />
                  En Gestion Moda ya no figura con el tipo <strong>Mayorista</strong> (se lo cambiaron
                  o lo dieron de baja). Queda acá con todo su historial: archivalo si ya no le hacés
                  seguimiento.
                </div>
              )}

              {client.notes && <p className="wh-detail-notes">{client.notes}</p>}

              {/* Métricas */}
              <div className="wh-detail-metrics">
                <Metric value={formatNumber(m.total_sales)} label="ventas" />
                <Metric value={formatNumber(m.total_units)} label="unidades" />
                <Metric value={formatMoney(m.total_amount)} label="facturado" />
                <Metric value={formatMoney(m.avg_ticket)} label="ticket prom." />
                <Metric
                  value={m.last_sale_date ? formatDate(m.last_sale_date) : '—'}
                  label={m.days_since_sale != null ? `última compra · ${m.days_since_sale}d` : 'última compra'}
                />
                <Metric
                  value={m.avg_days_between_purchases ? `${m.avg_days_between_purchases}d` : '—'}
                  label="frecuencia"
                />
              </div>

              {client.needs_sales_sync && (
                <div className="wh-banner">
                  Este cliente todavía no tiene ventas sincronizadas. Usá "Sincronizar ventas" en el panel.
                </div>
              )}

              {/* Timeline de contactos */}
              <h3 className="wh-section-title">Seguimiento ({data.contacts.length})</h3>
              {data.contacts.length === 0 && (
                <p className="wh-muted">Todavía no se registró ningún contacto con este cliente.</p>
              )}
              <div className="wh-timeline">
                {data.contacts.map(c => (
                  <div key={c.id} className="wh-timeline-item">
                    <div className="wh-timeline-head">
                      <strong>{formatDate(c.contacted_at)}</strong>
                      {c.outcome && (
                        <span className={`wh-outcome wh-outcome-${c.outcome}`}>{OUTCOME_LABEL[c.outcome]}</span>
                      )}
                      {c.seller && <span className="wh-seller">{c.seller}</span>}
                      <span className="wh-timeline-tools">
                        <button className="btn-history-icon" title="Editar"
                          onClick={() => { setLogContact(c); setShowLog(true) }}>
                          <Pencil size={14} />
                        </button>
                        <button className="btn-history-icon" title="Borrar"
                          onClick={() => askDeleteContact(c)}>
                          <Trash2 size={14} />
                        </button>
                      </span>
                    </div>
                    {c.note && <p className="wh-timeline-note">"{c.note}"</p>}
                    {c.next_contact_date && (
                      <p className="wh-timeline-next">Próximo contacto: {formatDate(c.next_contact_date)}</p>
                    )}
                  </div>
                ))}
              </div>

              {/* Ventas */}
              <h3 className="wh-section-title">Compras ({data.sales.length})</h3>
              {data.sales.length === 0 && (
                <p className="wh-muted">Sin compras registradas en el período sincronizado.</p>
              )}
              {data.sales.length > 0 && (
                <div className="ct-table-container wh-sales-table">
                  <table className="ct-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Unidades</th>
                        <th>Monto</th>
                        <th>Canal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sales.map(s => (
                        <tr key={s.id}>
                          <td className="td-date">{formatDate(s.date_sale)}</td>
                          <td>{formatNumber(s.items_sold)}</td>
                          <td>{formatMoney(s.total_price)}</td>
                          <td className="wh-muted">{s.channel || s.store || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {client && editing && (
            <form onSubmit={saveEdit}>
              <div className="form-group">
                <label htmlFor="wh-e-name">Nombre *</label>
                <input id="wh-e-name" type="text" value={form.name}
                  onChange={e => set('name', e.target.value)} disabled={saving} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="wh-e-phone">Teléfono</label>
                  <input id="wh-e-phone" type="text" value={form.phone}
                    onChange={e => set('phone', e.target.value)} disabled={saving} />
                </div>
                <div className="form-group">
                  <label htmlFor="wh-e-email">Email</label>
                  <input id="wh-e-email" type="email" value={form.email}
                    onChange={e => set('email', e.target.value)} disabled={saving} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="wh-e-assigned">Vendedor asignado</label>
                  {sellers.length > 0 ? (
                    <select id="wh-e-assigned" value={form.assigned_to}
                      onChange={e => set('assigned_to', e.target.value)} disabled={saving}>
                      <option value="">Sin asignar</option>
                      {sellers.map(s => <option key={s} value={s}>{s}</option>)}
                      {form.assigned_to && !sellers.includes(form.assigned_to) && (
                        <option value={form.assigned_to}>{form.assigned_to}</option>
                      )}
                    </select>
                  ) : (
                    <input id="wh-e-assigned" type="text" value={form.assigned_to}
                      onChange={e => set('assigned_to', e.target.value)} disabled={saving} />
                  )}
                </div>
                <div className="form-group">
                  <label htmlFor="wh-e-tags">Etiquetas</label>
                  <input id="wh-e-tags" type="text" value={form.tags}
                    onChange={e => set('tags', e.target.value)} disabled={saving} />
                  <small className="form-hint">Separadas por coma</small>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="wh-e-notes">Nota general del cliente</label>
                <textarea id="wh-e-notes" rows={3} value={form.notes}
                  onChange={e => set('notes', e.target.value)} disabled={saving}
                  placeholder="Condiciones de pago, preferencias, contacto alternativo..." />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {showLog && client && (
        <ContactLogModal
          client={client}
          contact={logContact}
          sellers={sellers}
          onClose={() => { setShowLog(false); setLogContact(null) }}
          onSaved={afterLog}
        />
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          detail={confirm.detail}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          busy={confirmBusy}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function Metric({ value, label }) {
  return (
    <div className="wh-detail-metric">
      <span className="wh-detail-metric-value">{value}</span>
      <span className="wh-detail-metric-label">{label}</span>
    </div>
  )
}
