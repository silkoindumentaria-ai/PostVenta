// Botón + progreso del sync del padrón de clientes de Gestion Moda.
// El espejo (tabla gm_clients) es de donde salen los teléfonos de las ventas:
// la API de ventas no devuelve el celular, así que sin este sync no hay WhatsApp.
import { RefreshCw } from 'lucide-react'
import { formatAge } from '../utils/format.js'

export default function ClientsSync({ status, onSync }) {
  const running = status?.status === 'running'
  const failed = status?.status === 'error'
  const age = formatAge(status?.synced_at)

  const progress = running && status.total_pages
    ? `${status.page}/${status.total_pages}`
    : null

  let title = 'Baja el padrón de clientes de Gestion Moda para completar los teléfonos'
  if (failed) title = `Último sync con error: ${status.error || 'desconocido'}`
  else if (status?.total_clients) title = `${status.total_clients.toLocaleString('es-AR')} clientes en el padrón`

  return (
    <div className="clients-sync">
      <button
        className={`btn-sync-clients ${running ? 'is-running' : ''} ${failed ? 'is-error' : ''}`}
        onClick={onSync}
        disabled={running}
        title={title}
      >
        <RefreshCw size={14} className={running ? 'icon-spin' : ''} />
        {running
          ? `Sincronizando clientes${progress ? ` ${progress}` : ''}...`
          : 'Sincronizar clientes'}
      </button>
      {!running && age && (
        <span className={`sync-age ${status?.stale ? 'sync-stale' : ''}`}>
          Padrón actualizado {age}
        </span>
      )}
      {!running && !age && (
        <span className="sync-age sync-stale">Padrón vacío</span>
      )}
      {failed && <span className="sync-age sync-stale">Error en el último sync</span>}
    </div>
  )
}
