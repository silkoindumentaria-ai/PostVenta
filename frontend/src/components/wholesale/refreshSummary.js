// Resultado de un refresco contra GM. Devuelve { changed, text } para que quien
// lo muestre elija el icono; lo comparten la tarjeta y la ficha, así ambas dicen
// exactamente lo mismo.
export function describeRefresh(summary) {
  if (!summary) return { changed: false, text: 'Sin cambios' }

  const parts = []
  if (summary.phone_changed) {
    parts.push(summary.phone ? 'teléfono actualizado' : 'teléfono borrado en GM')
  }
  if (summary.email_changed) {
    parts.push(summary.email ? 'email actualizado' : 'email borrado en GM')
  }
  if (summary.sales_added) {
    parts.push(`${summary.sales_added} ${summary.sales_added === 1 ? 'venta' : 'ventas'}`)
  }
  if (summary.sales_removed) {
    parts.push(`${summary.sales_removed} ${summary.sales_removed === 1 ? 'venta dada de baja' : 'ventas dadas de baja'}`)
  }

  return parts.length
    ? { changed: true, text: parts.join(' · ') }
    : { changed: false, text: 'Sin cambios' }
}
