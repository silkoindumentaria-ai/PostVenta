// Formateo de fechas, montos y antigüedades. Todo en es-AR.

// 'YYYY-MM-DD' → 'DD/MM/YYYY'
export function formatDate(str) {
  if (!str) return '—'
  const [y, m, d] = str.split('-')
  return `${d}/${m}/${y}`
}

// 'YYYY-MM-DD' → 'DD/MM' (para listados densos)
export function formatDateShort(str) {
  if (!str) return '—'
  const [, m, d] = str.split('-')
  return `${d}/${m}`
}

// timestamptz → '21/05/2026 14:30'
export function formatDateTime(str) {
  if (!str) return '—'
  return new Date(str).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Antigüedad legible de un timestamp: 'recién', 'hace 12 min', 'hace 3 h', 'hace 2 d'
export function formatAge(timestamp) {
  if (!timestamp) return null
  const mins = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000)
  if (mins < 1) return 'recién'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} d`
}

// Días transcurridos entre dos fechas 'YYYY-MM-DD' (b por defecto: hoy).
export function daysBetween(from, to = todayStr()) {
  if (!from || !to) return null
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

// Fecha de hoy en 'YYYY-MM-DD'
export function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// Suma (o resta) días a una fecha 'YYYY-MM-DD'
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0]
}

// 3240000 → '$3.240.000'
export function formatMoney(value) {
  const n = Number(value) || 0
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

// 3240 → '3.240'
export function formatNumber(value) {
  return (Number(value) || 0).toLocaleString('es-AR')
}
