// Normalización de teléfonos argentinos y armado de links de WhatsApp.
// La misma lógica vive en el backend (backend/lib/db.js → normalizePhone) para
// poder cruzar al mismo cliente real entre sesiones y fuentes distintas.

export function formatPhoneForWhatsApp(raw) {
  if (!raw) return null
  let d = String(raw).replace(/\D/g, '')
  if (!d) return null
  // Saca el 0 inicial si el número es lo bastante largo
  if (d.startsWith('0') && d.length > 10) d = d.slice(1)
  // Ya trae código de país 54
  if (d.startsWith('54')) {
    // Agrega el 9 de celular si falta
    if (!d.startsWith('549') && d.length >= 12) d = '549' + d.slice(2)
    return d
  }
  // Antepone el código de Argentina
  return '549' + d
}

// Reemplaza [Nombre] por el primer nombre del cliente.
export function buildMessageText(message, clientName) {
  const firstName = clientName?.split(' ')[0] || 'cliente'
  return (message || '').replace(/\[Nombre\]/gi, firstName)
}

// Link de WhatsApp con mensaje pre-armado. Devuelve null si no hay teléfono.
export function buildWhatsAppUrl(phone, message, clientName) {
  const formatted = formatPhoneForWhatsApp(phone)
  if (!formatted) return null
  return `https://wa.me/${formatted}?text=${encodeURIComponent(buildMessageText(message, clientName))}`
}

// Link de WhatsApp sin mensaje: abre el chat en blanco.
export function buildPlainWhatsAppUrl(phone) {
  const formatted = formatPhoneForWhatsApp(phone)
  return formatted ? `https://wa.me/${formatted}` : null
}
