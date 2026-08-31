// Contenedor del módulo de mayoristas: agenda de próximos contactos, filtros y
// grilla de tarjetas. Es dueño de todos los modales del módulo, siguiendo el
// patrón de ContactsTable con HistoryModal.
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  RefreshCw, Settings, Plus, Search, AlertTriangle, CircleDot, Circle, Handshake,
  DownloadCloud, ChevronDown, ChevronRight, Clock, CircleCheck, CircleSlash, CircleQuestionMark,
} from 'lucide-react'
import WholesaleCard from './WholesaleCard.jsx'
import WholesaleClientModal from './WholesaleClientModal.jsx'
import AddWholesaleModal from './AddWholesaleModal.jsx'
import ContactLogModal from './ContactLogModal.jsx'
import WholesaleSettingsModal from './WholesaleSettingsModal.jsx'
import WholesaleGuideModal from './WholesaleGuideModal.jsx'
import ConfirmModal from '../ConfirmModal.jsx'
import { formatAge, addDays } from '../../utils/format.js'
import '../../Wholesale.css'

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'to_contact', label: 'Para contactar' },
  { key: 'warn', label: 'En riesgo' },
  { key: 'alert', label: 'Inactivos' },
  { key: 'never', label: 'Sin contactar' },
  { key: 'archived', label: 'Archivados' },
]

// En "Todos" la grilla se parte por el semáforo en vez de tirar los 90 mezclados
// en orden alfabético. El orden de las secciones es el de urgencia: primero los
// que todavía se recuperan, después el grueso de inactivos, y al final lo que no
// pide acción (plegado, para no comerse la pantalla).
const SECTIONS = [
  {
    key: 'warn',
    label: 'En riesgo',
    Icon: AlertTriangle,
    hint: s => `Entre ${s.warn_days} y ${s.alert_days} días sin comprar — todavía se recuperan`,
  },
  {
    key: 'alert',
    label: 'Inactivos',
    Icon: Clock,
    hint: s => `Más de ${s.alert_days} días sin comprar`,
  },
  {
    key: 'ok',
    label: 'Al día',
    Icon: CircleCheck,
    hint: s => `Compraron hace menos de ${s.warn_days} días — no piden acción`,
    foldedByDefault: true,
  },
  {
    key: 'none',
    label: 'Sin compras registradas',
    Icon: CircleSlash,
    hint: () => 'Están cargados en Gestion Moda pero todavía no compraron',
    foldedByDefault: true,
  },
]

// Cuántas tarjetas muestra una sección antes del "Ver más". Con 58 inactivos,
// mostrarlos todos de una es justamente el problema que esto resuelve.
const SECTION_PAGE = 12

// El orden por defecto es Facturado: dentro de un grupo de 58 inactivos, lo que
// decide a quién llamar primero es cuánto compró, no cómo se llama.
const SORTS = [
  { key: 'amount', label: 'Facturado', cmp: (a, b) => b.metrics.total_amount - a.metrics.total_amount },
  { key: 'units', label: 'Unidades', cmp: (a, b) => b.metrics.total_units - a.metrics.total_units },
  {
    key: 'recent',
    label: 'Última compra',
    // Sin compras al final: un null no puede ganarle a una fecha real.
    cmp: (a, b) => (b.metrics.last_sale_date || '').localeCompare(a.metrics.last_sale_date || ''),
  },
  { key: 'name', label: 'Nombre (A-Z)', cmp: (a, b) => a.name.localeCompare(b.name, 'es') },
]

export default function WholesalePanel({ onAgendaChange }) {
  const [data, setData] = useState(null)      // { clients, settings, today }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [seller, setSeller] = useState('')
  const [tag, setTag] = useState('')
  const [sortBy, setSortBy] = useState('amount')
  // Secciones plegadas y secciones a las que se les pidió "Ver más", por clave.
  const [folded, setFolded] = useState(
    () => Object.fromEntries(SECTIONS.filter(s => s.foldedByDefault).map(s => [s.key, true]))
  )
  const [shownAll, setShownAll] = useState({})

  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [logClient, setLogClient] = useState(null)
  // Archivar y eliminar viven acá porque se disparan desde dos lugares: el menú
  // de la tarjeta y la ficha. Así el texto de confirmación es uno solo.
  const [confirm, setConfirm] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const fetchClients = useCallback(async () => {
    try {
      // Se piden activos + archivados en una sola llamada; el panel los separa.
      const res = await fetch('/api/wholesale/clients?archived=1')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'No se pudieron cargar los mayoristas.')
      setData(body)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/wholesale/sales/sync-status')
      const body = await res.json()
      if (res.ok) setSyncStatus(body)
    } catch {
      /* el estado del sync es informativo: si falla, no se rompe el panel */
    }
  }, [])

  useEffect(() => { fetchClients(); fetchSyncStatus() }, [fetchClients, fetchSyncStatus])

  // Mientras el sync corre, poletear cada 3 s; al terminar, recargar las métricas.
  useEffect(() => {
    if (syncStatus?.status !== 'running') return
    const timer = setInterval(async () => {
      const res = await fetch('/api/wholesale/sales/sync-status')
      const body = await res.json()
      setSyncStatus(body)
      if (body.status !== 'running') fetchClients()
    }, 3000)
    return () => clearInterval(timer)
  }, [syncStatus?.status, fetchClients])

  const startSync = async () => {
    const res = await fetch('/api/wholesale/sales/sync', { method: 'POST' })
    const body = await res.json()
    setSyncStatus(prev => ({ ...prev, ...body }))
  }

  // Trae de Gestion Moda todos los clientes del tipo "Mayorista". Es rápido
  // (1 request a GM), así que se espera la respuesta y se muestra el resumen.
  const importFromGm = async () => {
    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch('/api/wholesale/clients/import', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'No se pudo importar desde Gestion Moda.')

      if (body.already_running) {
        setImportMsg('Ya hay una importación en curso.')
      } else {
        const partes = []
        if (body.imported) partes.push(`${body.imported} ${body.imported === 1 ? 'nuevo' : 'nuevos'}`)
        if (body.updated) partes.push(`${body.updated} ${body.updated === 1 ? 'actualizado' : 'actualizados'}`)
        if (body.restored) partes.push(`${body.restored} ${body.restored === 1 ? 'reactivado' : 'reactivados'}`)
        if (body.archived) partes.push(`${body.archived} ${body.archived === 1 ? 'archivado' : 'archivados'}`)
        if (body.flagged) partes.push(`${body.flagged} ya no ${body.flagged === 1 ? 'figura' : 'figuran'} en GM`)
        setImportMsg(
          `${body.total} mayoristas en Gestion Moda` +
          (partes.length ? ` — ${partes.join(' · ')}.` : '. Todo estaba al día.')
        )
      }

      setError(null)
      handleSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  const allClients = data?.clients || []
  const clients = allClients.filter(c => c.status !== 'archived')
  const archivedClients = allClients.filter(c => c.status === 'archived')
  const settings = data?.settings || { warn_days: 30, alert_days: 60, sellers: [] }
  const today = data?.today || new Date().toISOString().split('T')[0]

  // ── Agenda: vencidos / hoy / esta semana ────────────────────────────────────
  const agenda = useMemo(() => {
    const weekEnd = addDays(today, 7)
    const overdue = [], due = [], soon = []
    for (const c of clients) {
      const n = c.next_contact_date
      if (!n) continue
      if (n < today) overdue.push(c)
      else if (n === today) due.push(c)
      else if (n <= weekEnd) soon.push(c)
    }
    const byDate = (a, b) => a.next_contact_date.localeCompare(b.next_contact_date)
    return { overdue: overdue.sort(byDate), due: due.sort(byDate), soon: soon.sort(byDate) }
  }, [clients, today])

  // El badge del header muestra lo que hay que hacer hoy (vencidos + de hoy).
  useEffect(() => {
    if (onAgendaChange) onAgendaChange(agenda.overdue.length + agenda.due.length)
  }, [agenda.overdue.length, agenda.due.length, onAgendaChange])

  const allTags = useMemo(
    () => [...new Set(clients.flatMap(c => c.tags || []))].sort(),
    [clients]
  )

  const sortCmp = useMemo(
    () => (SORTS.find(s => s.key === sortBy) || SORTS[0]).cmp,
    [sortBy]
  )

  const filtered = useMemo(() => (filter === 'archived' ? archivedClients : clients).filter(c => {
    const q = search.trim().toLowerCase()
    if (q && !c.name.toLowerCase().includes(q) && !(c.phone || '').includes(q)) return false
    if (seller && c.assigned_to !== seller) return false
    if (tag && !(c.tags || []).includes(tag)) return false

    if (filter === 'to_contact') return !!c.next_contact_date && c.next_contact_date <= today
    if (filter === 'warn') return c.alert_status === 'warn'
    if (filter === 'alert') return c.alert_status === 'alert'
    if (filter === 'never') return !c.last_contact_date
    return true
  }).sort(sortCmp), [clients, archivedClients, search, filter, seller, tag, today, sortCmp])

  // Solo se agrupa en "Todos": si hay una píldora activa, esa píldora YA es la
  // segmentación y volver a partirla en secciones sería redundante.
  const grouped = filter === 'all'

  const sections = useMemo(() => {
    if (!grouped) return []
    const by = {}
    for (const c of filtered) (by[c.alert_status] ||= []).push(c)
    return SECTIONS
      .map(sec => ({ ...sec, clients: by[sec.key] || [] }))
      .filter(sec => sec.clients.length > 0)
  }, [grouped, filtered])

  const counts = useMemo(() => ({
    all: clients.length,
    to_contact: clients.filter(c => c.next_contact_date && c.next_contact_date <= today).length,
    warn: clients.filter(c => c.alert_status === 'warn').length,
    alert: clients.filter(c => c.alert_status === 'alert').length,
    never: clients.filter(c => !c.last_contact_date).length,
    archived: archivedClients.length,
  }), [clients, archivedClients, today])

  const running = syncStatus?.status === 'running'
  const syncFailed = syncStatus?.status === 'error'
  const pendingBackfill = syncStatus?.pending_backfill || 0

  const handleSaved = () => { fetchClients(); fetchSyncStatus() }

  // El endpoint de refresco ya devuelve la tarjeta con las métricas recalculadas,
  // así que se reemplaza en el array en vez de recargar el listado entero.
  const handleRefreshed = useCallback(updated => {
    setData(prev => prev && {
      ...prev,
      clients: prev.clients.map(c => (c.id === updated.id ? updated : c)),
    })
  }, [])

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

  const askArchive = useCallback(client => setConfirm({
    title: 'Archivar mayorista',
    message: `${client.name} va a dejar de aparecer en el listado.`,
    detail: 'No se borra nada: su historial de contactos y sus compras quedan guardados. Lo vas a poder ver y restaurar cuando quieras desde el filtro "Archivados".',
    confirmLabel: 'Archivar',
    danger: false,
    onConfirm: () => runConfirmed(async () => {
      const res = await fetch(`/api/wholesale/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'No se pudo archivar.')
      setDetailId(null)
      fetchClients()
    }),
  }), [fetchClients])

  // Restaurar es lo inverso de archivar: vuelve a status 'active' con todo su
  // historial intacto. No pide confirmación porque no destruye nada.
  const restore = useCallback(async client => {
    try {
      const res = await fetch(`/api/wholesale/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'No se pudo restaurar.')
      setDetailId(null)
      fetchClients()
    } catch (err) {
      setError(err.message)
    }
  }, [fetchClients])

  const askDelete = useCallback(client => setConfirm({
    title: 'Eliminar mayorista',
    message: `¿Seguro que querés eliminar a ${client.name} del CRM?`,
    detail: 'Se borran también sus contactos registrados y sus compras cacheadas. Si solo querés sacarlo de la vista, usá Archivar.',
    confirmLabel: 'Eliminar definitivamente',
    danger: true,
    onConfirm: () => runConfirmed(async () => {
      const res = await fetch(`/api/wholesale/clients/${client.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error || 'No se pudo eliminar.')
      setDetailId(null)
      fetchClients()
    }),
  }), [fetchClients])

  if (loading) {
    return <div className="loading-state"><div className="spinner" /><p>Cargando mayoristas...</p></div>
  }

  return (
    <div className="wh-wrapper">
      {/* Barra de sync + acciones */}
      <div className="wh-topbar">
        <div className="wh-sync">
          <button
            className={`btn-sync-clients ${running ? 'is-running' : ''} ${syncFailed ? 'is-error' : ''}`}
            onClick={startSync}
            disabled={running}
            title={syncFailed ? `Último sync con error: ${syncStatus.error || 'desconocido'}` : 'Baja las ventas de Gestion Moda de los mayoristas cargados'}
          >
            <RefreshCw size={14} className={running ? 'icon-spin' : ''} />
            {running
              ? `Sincronizando ventas${syncStatus.total_pages ? ` (cliente ${syncStatus.page} de ${syncStatus.total_pages})` : ''}...`
              : 'Sincronizar ventas'}
          </button>
          {running && syncStatus.sales_saved > 0 && (
            <span className="sync-age">{syncStatus.sales_saved} ventas guardadas</span>
          )}
          {!running && syncStatus?.finished_at && (
            <span className="sync-age">Ventas actualizadas {formatAge(syncStatus.finished_at)}</span>
          )}
          {syncFailed && <span className="sync-age sync-stale">Error en el último sync</span>}
        </div>

        <div className="wh-topbar-actions">
          <button
            className="btn btn-secondary wh-btn-help"
            onClick={() => setShowGuide(true)}
            title="Cómo usar esta vista: puesta a punto, rutina diaria y qué significa cada control"
          >
            <CircleQuestionMark size={15} /> Cómo usar
          </button>
          <button className="btn btn-secondary" onClick={() => setShowSettings(true)} title="Umbrales, vendedores y tipo de cliente">
            <Settings size={15} /> Configuración
          </button>
          <button className="btn btn-secondary" onClick={() => setShowAdd(true)} title="Para un mayorista que todavía no está etiquetado en Gestion Moda">
            <Plus size={15} /> Agregar a mano
          </button>
          <button
            className="btn-new-session"
            onClick={importFromGm}
            disabled={importing}
            title="Trae todos los clientes que en Gestion Moda tienen el tipo Mayorista"
          >
            <DownloadCloud size={15} className={importing ? 'icon-spin' : ''} />
            {importing ? 'Importando...' : 'Importar de GM'}
          </button>
        </div>
      </div>

      {importMsg && <div className="wh-banner wh-banner-ok">{importMsg}</div>}

      {!running && pendingBackfill > 0 && (
        <div className="wh-banner">
          <AlertTriangle size={15} />
          {pendingBackfill === 1
            ? 'Hay 1 mayorista nuevo sin historial de ventas.'
            : `Hay ${pendingBackfill} mayoristas nuevos sin historial de ventas.`}
          {' '}Sincronizá las ventas para traer sus compras de los últimos {settings.history_months || 12} meses.
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      {clients.length === 0 && !error && (
        <div className="empty-state">
          <div className="empty-icon"><Handshake size={48} strokeWidth={1.5} /></div>
          <h2>Clientes mayoristas</h2>
          <p>
            Traé de Gestion Moda todos los clientes con el tipo <strong>Mayorista</strong> para
            llevarles un seguimiento personal: compras, contactos y próximos llamados.
          </p>
          <button className="btn btn-primary large" onClick={importFromGm} disabled={importing}>
            <DownloadCloud size={16} className={importing ? 'icon-spin' : ''} />
            {importing ? 'Importando...' : 'Importar de Gestion Moda'}
          </button>
          <button className="btn btn-secondary wh-empty-alt" onClick={() => setShowAdd(true)}>
            <Plus size={15} /> O agregar uno a mano
          </button>
        </div>
      )}

      {clients.length > 0 && (
        <>
          {/* Agenda */}
          {(agenda.overdue.length > 0 || agenda.due.length > 0 || agenda.soon.length > 0) && (
            <div className="wh-agenda">
              <AgendaGroup
                title="Vencidos" tone="overdue" Icon={AlertTriangle}
                clients={agenda.overdue} today={today}
                onOpen={setDetailId} onLog={setLogClient}
              />
              <AgendaGroup
                title="Para contactar hoy" tone="due" Icon={CircleDot}
                clients={agenda.due} today={today}
                onOpen={setDetailId} onLog={setLogClient}
              />
              <AgendaGroup
                title="Esta semana" tone="soon" Icon={Circle}
                clients={agenda.soon} today={today}
                onOpen={setDetailId} onLog={setLogClient}
              />
            </div>
          )}

          {/* Filtros */}
          <div className="wh-controls">
            <div className="wh-search-wrap">
              <Search size={15} className="wh-search-icon" />
              <input
                className="ct-search wh-search-input"
                type="text"
                placeholder="Buscar por nombre o teléfono..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="ct-filters">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`filter-pill ${filter === f.key ? 'active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} <span className="pill-count">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <label className="wh-sort">
              <span className="wh-sort-label">Ordenar por</span>
              <select className="wh-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            {(settings.sellers || []).length > 0 && (
              <select className="wh-select" value={seller} onChange={e => setSeller(e.target.value)}>
                <option value="">Todos los vendedores</option>
                {settings.sellers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {allTags.length > 0 && (
              <select className="wh-select" value={tag} onChange={e => setTag(e.target.value)}>
                <option value="">Todas las etiquetas</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          {/* Grilla: por secciones en "Todos", plana cuando hay una píldora activa */}
          {grouped
            ? sections.map(sec => (
                <ClientSection
                  key={sec.key}
                  section={sec}
                  settings={settings}
                  today={today}
                  folded={!!folded[sec.key]}
                  onToggleFold={() => setFolded(f => ({ ...f, [sec.key]: !f[sec.key] }))}
                  showAll={!!shownAll[sec.key]}
                  onShowAll={() => setShownAll(s => ({ ...s, [sec.key]: true }))}
                  onOpen={setDetailId}
                  onLog={setLogClient}
                  onRefreshed={handleRefreshed}
                  onArchive={askArchive}
                  onDelete={askDelete}
                  onRestore={restore}
                />
              ))
            : (
              <div className="wh-grid">
                {filtered.map(c => (
                  <WholesaleCard
                    key={c.id}
                    client={c}
                    today={today}
                    onOpen={() => setDetailId(c.id)}
                    onLog={() => setLogClient(c)}
                    onRefreshed={handleRefreshed}
                    onArchive={askArchive}
                    onDelete={askDelete}
                    onRestore={restore}
                  />
                ))}
              </div>
            )}

          {filtered.length === 0 && (
            <p className="wh-no-results">
              {filter === 'archived'
                ? 'No hay mayoristas archivados.'
                : 'Sin resultados para los filtros actuales.'}
            </p>
          )}

          <div className="ct-footer">
            {filter === 'archived'
              ? `Mostrando ${filtered.length} de ${archivedClients.length} archivados`
              : `Mostrando ${filtered.length} de ${clients.length} mayoristas`}
          </div>
        </>
      )}

      {showAdd && (
        <AddWholesaleModal
          sellers={settings.sellers || []}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); handleSaved() }}
        />
      )}

      {showSettings && (
        <WholesaleSettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); handleSaved() }}
        />
      )}

      {showGuide && <WholesaleGuideModal onClose={() => setShowGuide(false)} />}

      {detailId && (
        <WholesaleClientModal
          clientId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={handleSaved}
          onArchive={askArchive}
          onDelete={askDelete}
          onRestore={restore}
        />
      )}

      {logClient && (
        <ContactLogModal
          client={logClient}
          sellers={settings.sellers || []}
          onClose={() => setLogClient(null)}
          onSaved={() => { setLogClient(null); handleSaved() }}
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

// Una sección del listado: encabezado plegable + grilla recortada a SECTION_PAGE.
// El encabezado es un <button aria-expanded> de verdad y la grilla un <section>
// rotulado por él, así un lector de pantalla anuncia el grupo y su estado.
function ClientSection({
  section, settings, today, folded, onToggleFold, showAll, onShowAll,
  onOpen, onLog, onRefreshed, onArchive, onDelete, onRestore,
}) {
  const { key, label, Icon, hint, clients } = section
  const gridId = `wh-sec-${key}`
  const visible = showAll ? clients : clients.slice(0, SECTION_PAGE)
  const rest = clients.length - visible.length

  return (
    <div className="wh-section">
      <button
        type="button"
        className={`wh-sec-head wh-sec-${key}`}
        onClick={onToggleFold}
        aria-expanded={!folded}
        aria-controls={gridId}
      >
        {folded ? <ChevronRight size={16} className="wh-sec-caret" /> : <ChevronDown size={16} className="wh-sec-caret" />}
        <Icon size={16} className="wh-sec-icon" />
        <span className="wh-sec-title">{label}</span>
        <span className="pill-count">{clients.length}</span>
        <span className="wh-sec-hint">{hint(settings)}</span>
      </button>

      {!folded && (
        <>
          <section id={gridId} className="wh-grid" aria-label={`${label} (${clients.length})`}>
            {visible.map(c => (
              <WholesaleCard
                key={c.id}
                client={c}
                today={today}
                onOpen={() => onOpen(c.id)}
                onLog={() => onLog(c)}
                onRefreshed={onRefreshed}
                onArchive={onArchive}
                onDelete={onDelete}
                onRestore={onRestore}
              />
            ))}
          </section>

          {rest > 0 && (
            <button type="button" className="wh-sec-more" onClick={onShowAll}>
              <ChevronDown size={15} />
              Ver {rest === 1 ? 'el restante' : `los ${rest} restantes`} de {label.toLowerCase()}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// Grupo de la agenda. No se renderiza si está vacío.
function AgendaGroup({ title, tone, Icon, clients, today, onOpen, onLog }) {
  if (clients.length === 0) return null

  return (
    <div className={`wh-agenda-group wh-agenda-${tone}`}>
      <h3 className="wh-agenda-title">
        <Icon size={15} className="wh-agenda-icon" />
        {title} <span className="pill-count">{clients.length}</span>
      </h3>
      <ul className="wh-agenda-list">
        {clients.map(c => {
          const late = tone === 'overdue'
            ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${c.next_contact_date}T00:00:00Z`)) / 86400000)
            : 0
          return (
            <li key={c.id} className="wh-agenda-item">
              <button className="wh-agenda-name" onClick={() => onOpen(c.id)}>{c.name}</button>
              {late > 0 && <span className="wh-agenda-late">{late} {late === 1 ? 'día' : 'días'} tarde</span>}
              {c.last_contact?.note && <span className="wh-agenda-note">"{c.last_contact.note}"</span>}
              {c.assigned_to && <span className="wh-agenda-seller">{c.assigned_to}</span>}
              <button className="btn btn-secondary wh-btn-sm" onClick={() => onLog(c)}>Registrar</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
