import { useState } from 'react'

function formatDate(str) {
  if (!str) return '—'
  const [y, m, d] = str.split('-')
  return `${d}/${m}/${y}`
}

function formatPhoneForWhatsApp(raw) {
  if (!raw) return null
  let d = raw.replace(/\D/g, '')
  if (!d) return null
  // Remove leading 0 if number is long enough
  if (d.startsWith('0') && d.length > 10) d = d.slice(1)
  // Already has country code 54
  if (d.startsWith('54')) {
    // Add 9 for mobile if missing
    if (!d.startsWith('549') && d.length >= 12) d = '549' + d.slice(2)
    return d
  }
  // Add Argentina code
  return '549' + d
}

function buildWhatsAppUrl(phone, message, clientName) {
  const formatted = formatPhoneForWhatsApp(phone)
  if (!formatted) return null
  const firstName = clientName?.split(' ')[0] || 'cliente'
  const text = message.replace(/\[Nombre\]/gi, firstName)
  return `https://wa.me/${formatted}?text=${encodeURIComponent(text)}`
}

export default function ContactsTable({ session, contacts, onToggle, onFinish }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

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
            <span className="progress-warn">⚠ {noPhone} sin teléfono</span>
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
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="ct-empty-row">
                  Sin resultados para la búsqueda actual
                </td>
              </tr>
            )}
            {filtered.map(c => {
              const waUrl = buildWhatsAppUrl(c.client_phone, session.whatsapp_message, c.client_name)
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
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
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
                        onChange={e => onToggle(c.id, e.target.checked)}
                      />
                      <span className="check-box" />
                    </label>
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
    </div>
  )
}
