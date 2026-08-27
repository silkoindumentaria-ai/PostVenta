// Tarjeta de un mayorista. El borde izquierdo es el semáforo de inactividad.
// Toda la tarjeta es clickeable y abre la ficha; por eso cada control interno
// corta la propagación del click.
import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Clock, EllipsisVertical, Archive, ArchiveRestore, Trash2, Pencil, AlertTriangle, Check } from 'lucide-react'
import { WhatsAppIcon } from '../icons.jsx'
import { buildPlainWhatsAppUrl } from '../../utils/phone.js'
import { formatDate, formatMoney, formatNumber } from '../../utils/format.js'
import { describeRefresh } from './refreshSummary.js'

const STATUS_LABEL = {
  ok: 'Activo',
  warn: 'En riesgo',
  alert: 'Inactivo',
  none: 'Sin compras',
}

const OUTCOME_LABEL = {
  compro: 'Compró',
  va_a_comprar: 'Va a comprar',
  pidio_info: 'Pidió info',
  no_contesta: 'No contesta',
  no_interesa: 'No le interesa',
}

export default function WholesaleCard({ client, today, onOpen, onLog, onRefreshed, onArchive, onDelete, onRestore }) {
  const archived = client.status === 'archived'
  const m = client.metrics || {}
  const waUrl = buildPlainWhatsAppUrl(client.phone)
  const overdue = !!(client.next_contact_date && client.next_contact_date <= today)

  const [refreshing, setRefreshing] = useState(false)
  const [msg, setMsg] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // El resultado del refresco se muestra unos segundos y se va solo.
  useEffect(() => {
    if (!msg) return
    const timer = setTimeout(() => setMsg(null), 6000)
    return () => clearTimeout(timer)
  }, [msg])

  // Cerrar el menú al hacer click afuera o con Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = e => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Envuelve un handler para que el click no abra además la ficha.
  const stop = handler => e => { e.stopPropagation(); handler?.(e) }

  const refresh = async () => {
    setRefreshing(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/wholesale/clients/${client.id}/refresh`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'No se pudo actualizar.')
      setMsg({ tone: 'ok', ...describeRefresh(body.summary) })
      onRefreshed(body.client)
    } catch (err) {
      setMsg({ tone: 'error', changed: false, text: err.message })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div
      className={`wh-card wh-status-${client.alert_status} ${archived ? 'wh-card-archived' : ''}`}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      role="button"
      tabIndex={0}
      title="Ver ficha completa"
    >
      <div className="wh-card-head">
        <span className="wh-card-name">{client.name}</span>

        <div className="wh-card-head-right">
          <span className={`wh-chip ${archived ? 'wh-chip-archived' : `wh-chip-${client.alert_status}`}`}>
            {archived ? 'Archivado' : STATUS_LABEL[client.alert_status]}
          </span>

          <div className="wh-menu" ref={menuRef}>
            <button
              className="wh-icon-btn"
              onClick={stop(() => setMenuOpen(o => !o))}
              title="Más acciones"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <EllipsisVertical size={16} />
            </button>

            {menuOpen && (
              <div className="wh-menu-pop" role="menu">
                <button className="wh-menu-item" role="menuitem"
                  onClick={stop(() => { setMenuOpen(false); onOpen() })}>
                  <Pencil size={14} /> Ver y editar ficha
                </button>
                {archived ? (
                  <button className="wh-menu-item" role="menuitem"
                    onClick={stop(() => { setMenuOpen(false); onRestore(client) })}>
                    <ArchiveRestore size={14} /> Restaurar
                  </button>
                ) : (
                  <button className="wh-menu-item" role="menuitem"
                    onClick={stop(() => { setMenuOpen(false); onArchive(client) })}>
                    <Archive size={14} /> Archivar
                  </button>
                )}
                <button className="wh-menu-item wh-menu-danger" role="menuitem"
                  onClick={stop(() => { setMenuOpen(false); onDelete(client) })}>
                  <Trash2 size={14} /> Eliminar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="wh-card-sub">
        {m.last_sale_date
          ? <>última compra {formatDate(m.last_sale_date)} · <strong>{m.days_since_sale}d</strong></>
          : client.needs_sales_sync
            ? <span className="wh-muted">ventas sin sincronizar</span>
            : <span className="wh-muted">sin compras registradas</span>}
      </div>

      <div className="wh-card-metrics">
        <div className="wh-metric">
          <span className="wh-metric-value">{formatNumber(m.total_units)}</span>
          <span className="wh-metric-label">unidades</span>
        </div>
        <div className="wh-metric">
          <span className="wh-metric-value">{formatMoney(m.total_amount)}</span>
          <span className="wh-metric-label">facturado</span>
        </div>
        <div className="wh-metric">
          <span className="wh-metric-value">{formatNumber(m.total_sales)}</span>
          <span className="wh-metric-label">ventas</span>
        </div>
      </div>

      {m.total_sales > 0 && (
        <div className="wh-card-line wh-muted">
          Ticket prom. {formatMoney(m.avg_ticket)} · {formatNumber(m.avg_units_per_sale)} u. por venta
          {m.avg_days_between_purchases && <> · compra cada ~{m.avg_days_between_purchases}d</>}
        </div>
      )}

      {(client.tags || []).length > 0 && (
        <div className="wh-card-tags">
          {client.tags.map(t => <span key={t} className="wh-tag">{t}</span>)}
        </div>
      )}

      <div className="wh-card-contact">
        {client.last_contact ? (
          <div className="wh-card-line">
            <Clock size={13} className="wh-inline-icon" />
            {formatDate(client.last_contact.contacted_at)}
            {client.last_contact.outcome && (
              <span className={`wh-outcome wh-outcome-${client.last_contact.outcome}`}>
                {OUTCOME_LABEL[client.last_contact.outcome]}
              </span>
            )}
            {client.last_contact.note && <span className="wh-note">"{client.last_contact.note}"</span>}
          </div>
        ) : (
          <div className="wh-card-line wh-muted">Todavía no se registraron contactos</div>
        )}

        <div className={`wh-card-line wh-next ${overdue ? 'wh-next-overdue' : ''}`}>
          {client.next_contact_date
            ? <>
                Próximo contacto: <strong>{formatDate(client.next_contact_date)}</strong>
                {overdue && <AlertTriangle size={13} className="wh-inline-icon" />}
              </>
            : <span className="wh-muted">Sin próximo contacto agendado</span>}
          {client.assigned_to && <span className="wh-seller">{client.assigned_to}</span>}
        </div>
      </div>

      {msg && (
        <div className={`wh-refresh-msg ${msg.tone === 'error' ? 'wh-refresh-err' : ''}`}>
          {msg.tone === 'error'
            ? <AlertTriangle size={13} />
            : msg.changed ? <Check size={13} /> : null}
          {msg.text}
        </div>
      )}

      <div className="wh-card-actions">
        {waUrl
          ? (
            <a href={waUrl} target="_blank" rel="noopener noreferrer"
              className="wsp-link" onClick={e => e.stopPropagation()}>
              <WhatsAppIcon size={16} /> WhatsApp
            </a>
          )
          : <span className="wsp-disabled">Sin teléfono</span>}

        {archived ? (
          <button className="btn btn-primary wh-btn-sm" onClick={stop(() => onRestore(client))}>
            <ArchiveRestore size={14} /> Restaurar
          </button>
        ) : (
          <button className="btn btn-primary wh-btn-sm" onClick={stop(onLog)}>
            Registrar contacto
          </button>
        )}

        {client.gm_client_id && !archived && (
          <button
            className="wh-icon-btn wh-btn-refresh"
            onClick={stop(refresh)}
            disabled={refreshing}
            title="Actualizar teléfono, email y ventas desde Gestion Moda"
          >
            <RefreshCw size={16} className={refreshing ? 'icon-spin' : ''} />
          </button>
        )}
      </div>
    </div>
  )
}
