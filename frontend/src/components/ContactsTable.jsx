import { useState, useEffect, useRef } from 'react'
import { History, AlertTriangle, Check } from 'lucide-react'
import HistoryModal from './HistoryModal.jsx'
import { WhatsAppIcon } from './icons.jsx'
import { buildWhatsAppUrl, buildMessageText } from '../utils/phone.js'
import { formatDate } from '../utils/format.js'

export default function ContactsTable({ session, contacts, onToggle, onFinish, onRefreshPhones, syncStatus, onSyncStarted }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null)
  const [historyContactId, setHistoryContactId] = useState(null)
  // Quedó esperando a que termine un sync del padrón para reintentar el refresh.
  const [waitingSync, setWaitingSync] = useState(false)
  const prevSyncStatus = useRef(syncStatus?.status)

  const runRefresh = async () => {
    setRefreshing(true)
    setRefreshResult(null)
    try {
      const res = await fetch(`/api/sessions/${session.id}/refresh-phones`, { method: 'POST' })
      const data = await res.json()
      setRefreshResult(data.updated)
      // El padrón estaba vencido: el backend lanzó el sync y reintentamos al terminar.
      setWaitingSync(Boolean(data.sync_started))
      if (data.sync_started && onSyncStarted) onSyncStarted()
      if (onRefreshPhones) onRefreshPhones()
    } finally {
      setRefreshing(false)
    }
  }

  const handleRefresh = () => { runRefresh() }

  // Cuando el sync del padrón pasa de 'running' a terminado, reintentar solo.
  useEffect(() => {
    const prev = prevSyncStatus.current
    prevSyncStatus.current = syncStatus?.status
    if (!waitingSync) return
    if (prev === 'running' && syncStatus?.status === 'idle') {
      setWaitingSync(false)
      runRefresh()
    }
  }, [syncStatus?.status, waitingSync])

  const total = contacts.length
  const done = contacts.filter(c => c.contacted).length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const noPhone = contacts.filter(c => !c.client_phone).length

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      c.client_name.toLowerCase().includes(q) ||
      (c.client_phone || '').includes(q)
    const matchFilter =
      filter === 'all' ||
      (filter === 'pending' && !c.contacted) ||
      (filter === 'contacted' && c.contacted)
    return matchSearch && matchFilter
  })

  return (
    <div className="ct-wrapper">
      {/* Session header */}
      <div className="ct-header">
        <div className="ct-title-area">
          <h2 className="ct-title">{session.name}</h2>
          <div className="ct-meta">
            {session.channel_name && (
              <span className="badge badge-channel">{session.channel_name}</span>
            )}
            {session.store_name && (
              <span className="badge badge-store">{session.store_name}</span>
            )}
            <span className="badge badge-dates">
              {formatDate(session.date_from)} → {formatDate(session.date_to)}
            </span>
          </div>
        </div>
        <button className="btn btn-danger" onClick={onFinish}>
          Finalizar sesión
        </button>
      </div>

      {/* Progress */}
      <div className="ct-progress">
        <div className="progress-info">
          <span className="progress-text">
            <strong>{done}</strong> de <strong>{total}</strong> contactados
          </span>
          <span className="progress-pct">{pct}%</span>
          {noPhone > 0 && (
            <span className="progress-warn">
              <AlertTriangle size={14} className="wh-inline-icon" /> {noPhone} sin teléfono
              {session.source !== 'tn' && (
                <button
                  className="btn-refresh-phones"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  title="Buscar teléfonos faltantes en Gestion Moda"
                >
                  {refreshing ? 'Buscando...' : 'Refrescar teléfonos'}
                </button>
              )}
              {waitingSync && (
                <span className="refresh-waiting">
                  Actualizando el padrón de clientes
                  {syncStatus?.total_pages ? ` (${syncStatus.page}/${syncStatus.total_pages})` : ''}...
                </span>
              )}
              {refreshResult !== null && !waitingSync && (
                <span className="refresh-ok"><Check size={13} /> {refreshResult} actualizados</span>
              )}
            </span>
          )}
        </div>
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="ct-controls">
        <input
          className="ct-search"
          type="text"
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="ct-filters">
          <button
            className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Todos <span className="pill-count">{total}</span>
          </button>
          <button
            className={`filter-pill ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            Pendientes <span className="pill-count">{total - done}</span>
          </button>
          <button
            className={`filter-pill ${filter === 'contacted' ? 'active' : ''}`}
            onClick={() => setFilter('contacted')}
          >
            Contactados <span className="pill-count">{done}</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="ct-table-container">
        <table className="ct-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Fecha de compra</th>
              <th>Teléfono</th>
              <th>WhatsApp</th>
              <th>Contactado</th>
              <th>Historial</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="ct-empty-row">
                  Sin resultados para la búsqueda actual
                </td>
              </tr>
            )}
            {filtered.map(c => {
              const waUrl = buildWhatsAppUrl(c.client_phone, session.whatsapp_message, c.client_name)
              const finalMessage = buildMessageText(session.whatsapp_message, c.client_name)
              return (
                <tr key={c.id} className={c.contacted ? 'row-done' : ''}>
                  <td className="td-name">
                    <span className="client-name">{c.client_name}</span>
                  </td>
                  <td className="td-date">{formatDate(c.date_sale)}</td>
                  <td className="td-phone">
                    {c.client_phone
                      ? <span className="phone-text">{c.client_phone}</span>
                      : <span className="no-phone">Sin teléfono</span>
                    }
                  </td>
                  <td className="td-wsp">
                    {waUrl
                      ? (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="wsp-link"
                        >
                          <WhatsAppIcon size={18} />
                          Enviar mensaje
                        </a>
                      )
                      : <span className="wsp-disabled">—</span>
                    }
                  </td>
                  <td className="td-check">
                    <label className="check-wrap">
                      <input
                        type="checkbox"
                        checked={!!c.contacted}
                        onChange={e => onToggle(c.id, e.target.checked, e.target.checked ? finalMessage : null)}
                      />
                      <span className="check-box" />
                    </label>
                  </td>
                  <td className="td-history">
                    <button
                      type="button"
                      className="btn-history-icon"
                      title="Ver historial de contacto"
                      onClick={() => setHistoryContactId(c.id)}
                    >
                      <History size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="ct-footer">
        Mostrando {filtered.length} de {total} clientes
      </div>

      {historyContactId && (
        <HistoryModal contactId={historyContactId} onClose={() => setHistoryContactId(null)} />
      )}
    </div>
  )
}
