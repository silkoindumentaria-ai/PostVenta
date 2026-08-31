// ── Módulo de Clientes Mayoristas (CRM de seguimiento) ────────────────────────
// A diferencia de las sesiones de PostVenta (campañas masivas y puntuales), acá
// cada cliente se sigue individualmente a lo largo del tiempo: se registra cada
// contacto, qué respondió y cuándo hay que volver a llamarlo.
//
// Las ventas salen de un espejo local (wholesale_sales) que se llena consultando
// GM cliente por cliente con /ventas?search=<nombre> — ver lib/gm.js.
const express = require('express');
const { supabase, fetchAllRows, insertRows, upsertRows, normalizePhone } = require('./lib/db');
const { searchGmClients, fetchGmClientsByType, fetchClientSales, foldAccents } = require('./lib/gm');

const router = express.Router();

// Un 'running' más viejo que esto se da por muerto. Tiene que cubrir el backfill
// inicial completo: son ~2 requests por cliente a 50 req/min, o sea ~4 min para
// los 90 mayoristas de hoy, con margen de sobra para cuando crezcan.
const SYNC_STUCK_MS = 45 * 60 * 1000;
const OUTCOMES = ['compro', 'va_a_comprar', 'pidio_info', 'no_contesta', 'no_interesa'];

// Cada cuánto se reimporta el padrón de mayoristas solo, si auto_import está activo.
const IMPORT_STALE_MS = 24 * 60 * 60 * 1000;

// ── Helpers de fecha (todo en 'YYYY-MM-DD', sin horas, para evitar líos de TZ) ─
const todayStr = () => new Date().toISOString().split('T')[0];

function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().split('T')[0];
}

function daysBetween(fromStr, toStr) {
  const a = Date.parse(`${fromStr}T00:00:00Z`);
  const b = Date.parse(`${toStr}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

// ── Configuración del módulo (una sola fila, id = 1) ──────────────────────────
// gm_client_type_ids: qué "Tipo de Cliente" de GM cuenta como mayorista. Es un
// setting y no una constante porque la API NO expone la etiqueta: /clientes
// devuelve client_type_id (un número) y no hay endpoint de catálogo de tipos.
// Verificado contra la API real: hoy el 3 son los 90 mayoristas.
const DEFAULT_SETTINGS = {
  id: 1,
  warn_days: 30,
  alert_days: 60,
  history_months: 12,
  sellers: [],
  gm_client_type_ids: [3],
  auto_import: true,
};

async function getSettings() {
  const { data, error } = await supabase
    .from('wholesale_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Los defaults se mergean para que las columnas nuevas no queden undefined si
  // todavía no se corrió la migración.
  const row = data || {};
  const settings = { ...DEFAULT_SETTINGS, ...row };
  if (!Array.isArray(settings.gm_client_type_ids) || !settings.gm_client_type_ids.length) {
    settings.gm_client_type_ids = DEFAULT_SETTINGS.gm_client_type_ids;
  }
  return settings;
}

// ── Estado del sync de ventas (una sola fila, id = 1) ─────────────────────────
async function getSyncState() {
  const { data, error } = await supabase
    .from('wholesale_sync_state')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || { id: 1, status: 'idle', page: 0, total_pages: 0, sales_scanned: 0, sales_saved: 0 };
}

async function setSyncState(patch) {
  const { error } = await supabase
    .from('wholesale_sync_state')
    .upsert({ id: 1, ...patch }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

// ── Sync de ventas ────────────────────────────────────────────────────────────

// Unidades de la venta. items_sold viene en la raíz cuando se piden detalles;
// si faltara, se suma la cantidad de cada línea.
function unitsOf(sale) {
  if (Number.isFinite(sale.items_sold)) return sale.items_sold;
  const lines = sale.detalles || sale.items || [];
  const sum = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  return sum || null;
}

function saleRow(sale, syncedAt) {
  return {
    id: sale.id,
    gm_client_id: Number(sale.client_id),
    date_sale: sale.date_sale || null,
    items_sold: unitsOf(sale),
    total_price: Number(sale.total_price) || 0,
    channel_id: sale.channel_id || null,
    channel: sale.channel || null,
    store_id: sale.store_id || null,
    store: sale.store || null,
    synced_at: syncedAt,
  };
}

// Marca el sync como 'running' antes de arrancar y con await, para que el
// endpoint que lo dispara responda recién cuando el estado ya está escrito: si
// no, el frontend poletea, lee 'idle' y espera un sync que "todavía no arrancó".
async function claimSync() {
  const state = await getSyncState();
  if (state.status === 'running' && state.started_at
      && Date.now() - new Date(state.started_at).getTime() < SYNC_STUCK_MS) {
    console.log('Sync de ventas mayoristas ya en curso, se ignora el pedido.');
    return false;
  }

  await setSyncState({
    status: 'running',
    page: 0,
    total_pages: 0,
    sales_scanned: 0,
    sales_saved: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
  });

  return true;
}

// ── Refresco de un cliente contra GM ──────────────────────────────────────────
// Núcleo compartido: lo usan tanto el botón ⟳ de la tarjeta como el sync completo.
// Cuesta ~2 requests a GM (uno de datos de contacto, uno de ventas).
//
// Detalle contraintuitivo: el nombre se manda PLEGADO a /clientes (GM guarda los
// nombres con encoding roto y q=MUÑOZ devuelve 0 resultados) pero TAL CUAL a
// /ventas, que sí maneja bien la ñ y los acentos.
// Busca en GM los datos de contacto al día de un cliente (1 request).
// No existe GET /clientes/{id} y `q` no busca por id, así que se busca por nombre
// y se matchea por id entre los resultados. Si el nombre completo no lo trae, se
// reintenta con la palabra más larga (normalmente el apellido).
// El nombre va PLEGADO: GM guarda los nombres con encoding roto y q=MUÑOZ da 0.
async function lookupGmContact(gmClientId, name) {
  const gmId = Number(gmClientId);
  const folded = foldAccents(name || '');
  const longest = folded.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  const attempts = longest && longest !== folded ? [folded, longest] : [folded];

  for (const q of attempts) {
    if (!q || q.length < 2) continue;
    const found = await searchGmClients(q);
    const hit = found.find(c => Number(c.id) === gmId);
    if (hit) {
      return {
        name: (hit.name || '').trim() || name,
        phone: (hit.cellphone_number || hit.phone_number || '').trim() || null,
        email: (hit.email || '').trim() || null,
        active: hit.active !== false,
      };
    }
  }

  return null;
}

async function refreshClientFromGm(client, settings) {
  // sales_added = ventas nuevas; sales_total = todas las que GM devolvió para el cliente
  const result = {
    phone: client.phone, phone_changed: false,
    email: client.email, email_changed: false,
    sales_added: 0, sales_total: 0, sales_removed: 0,
  };
  if (!client.gm_client_id) return result;

  const gmId = Number(client.gm_client_id);
  const syncedAt = new Date().toISOString();

  // ── 1. Datos de contacto (teléfono y email) ─────────────────────────────────
  const gmContact = await lookupGmContact(gmId, client.name);

  if (gmContact) {
    const patch = {};

    if (gmContact.phone !== client.phone) {
      patch.phone = gmContact.phone;
      patch.phone_normalized = normalizePhone(gmContact.phone);
      result.phone = gmContact.phone;
      result.phone_changed = true;
    }

    if (gmContact.email !== client.email) {
      patch.email = gmContact.email;
      result.email = gmContact.email;
      result.email_changed = true;
    }

    if (Object.keys(patch).length) {
      const { error } = await supabase.from('wholesale_clients').update(patch).eq('id', client.id);
      if (error) throw new Error(error.message);
    }

    // El espejo del padrón se actualiza también: así se beneficia el resto del
    // panel (refresh-phones de PostVenta, el buscador de alta de mayoristas).
    // No se manda client_type_id a propósito: el upsert solo pisa las columnas
    // que van en el payload, y acá no lo tenemos.
    await upsertRows('gm_clients', [{
      id: gmId,
      name: gmContact.name,
      phone: gmContact.phone,
      phone_normalized: normalizePhone(gmContact.phone),
      email: gmContact.email,
      active: gmContact.active,
      synced_at: syncedAt,
    }]);
  }

  // ── 2. Ventas ───────────────────────────────────────────────────────────────
  const to = todayStr();
  const from = addMonths(to, -(settings.history_months || 12));

  const sales = await fetchClientSales(client.name, { from, to });

  // search matchea por cliente, número, email, factura o comentario, así que
  // pueden venir ventas de otros: el filtro por client_id es lo que da exactitud.
  const byId = {};
  for (const s of sales) {
    if (Number(s.client_id) !== gmId) continue;
    if (s.budget || s.active === false) continue;   // presupuestos y anuladas no son compras
    byId[s.id] = saleRow(s, syncedAt);
  }

  // Se leen los ids locales ANTES de escribir, para poder distinguir las ventas
  // realmente nuevas de las que ya teníamos (si no, refrescar dos veces reportaría
  // las mismas ventas como nuevas cada vez).
  const localIds = (await fetchAllRows(() =>
    supabase.from('wholesale_sales').select('id')
      .eq('gm_client_id', gmId)
      .gte('date_sale', from)
      .lte('date_sale', to)
  )).map(r => r.id);

  const known = new Set(localIds);
  const rows = Object.values(byId);
  if (rows.length) await upsertRows('wholesale_sales', rows);
  result.sales_added = rows.filter(r => !known.has(r.id)).length;
  result.sales_total = rows.length;

  // Ventas que teníamos guardadas en el rango y que GM ya no devuelve: se
  // anularon o se borraron, así que se sacan para que las métricas no mientan.
  const stale = localIds.filter(id => !(id in byId));
  if (stale.length) {
    const { error } = await supabase.from('wholesale_sales').delete().in('id', stale);
    if (error) throw new Error(error.message);
    result.sales_removed = stale.length;
  }

  const { error: markErr } = await supabase
    .from('wholesale_clients')
    .update({ sales_synced_at: syncedAt })
    .eq('id', client.id);
  if (markErr) throw new Error(markErr.message);

  return result;
}

// ── Import de mayoristas por tipo de cliente de GM ────────────────────────────
// GM ya sabe quién es mayorista: es el campo "Tipo de Cliente". En vez de cargar
// los mayoristas a mano de a uno, se listan los del tipo configurado y se
// espeja el padrón acá. Cuesta 1 request a GM (el tipo 3 entra en una sola
// página de 200) y corre en un par de segundos, así que es síncrono.
//
// Reglas de convivencia con las altas manuales:
//   • source 'manual' NUNCA se toca: ni se archiva ni se le pisan los datos.
//   • Los campos del usuario (assigned_to, tags, notes, agenda) no se tocan nunca.
//   • El que deja de figurar como mayorista en GM se archiva solo si no tiene
//     ningún contacto registrado; si tiene seguimiento, queda activo y marcado
//     con gm_type_ok = false para que el panel lo muestre con un cartel.
// Nada se borra jamás: archivar es reversible desde el panel.

function gmClientRow(c, syncedAt) {
  const phone = (c.cellphone_number || c.phone_number || '').trim() || null;
  return {
    id: c.id,
    name: (c.name || '').trim() || null,   // GM devuelve nombres con tabs y espacios de más
    phone,
    phone_normalized: normalizePhone(phone),
    email: (c.email || '').trim() || null,
    client_type_id: c.client_type_id ?? null,
    active: c.active !== false,
    synced_at: syncedAt,
  };
}

// Evita que dos requests simultáneos disparen dos imports a la vez. Alcanza con
// una bandera de módulo: el import dura segundos y corre en una sola instancia.
let importInFlight = false;

async function importWholesaleClients() {
  const settings = await getSettings();
  const syncedAt = new Date().toISOString();

  const gmClients = await fetchGmClientsByType(settings.gm_client_type_ids);
  const mirrorRows = gmClients.map(c => gmClientRow(c, syncedAt)).filter(r => r.name);

  // El espejo del padrón se refresca de paso, sin esperar al sync completo.
  if (mirrorRows.length) await upsertRows('gm_clients', mirrorRows);

  // Todos los mayoristas vinculados a GM, archivados incluidos: una sola query.
  const linked = await fetchAllRows(() =>
    supabase.from('wholesale_clients')
      .select('id, gm_client_id, name, phone, email, status, source, gm_type_ok')
      .not('gm_client_id', 'is', null)
  );

  const existingBy = new Map(linked.map(c => [Number(c.gm_client_id), c]));
  const inGm = new Set(mirrorRows.map(r => Number(r.id)));

  const result = { imported: 0, updated: 0, archived: 0, flagged: 0, restored: 0, total: mirrorRows.length };

  // ── Altas: están en GM y no en la tabla ─────────────────────────────────────
  const nuevos = mirrorRows
    .filter(r => !existingBy.has(Number(r.id)))
    .map(r => ({
      gm_client_id: r.id,
      name: r.name,
      phone: r.phone,
      phone_normalized: r.phone_normalized,
      email: r.email,
      tags: [],
      source: 'gm_auto',
      gm_type_ok: true,
      sales_synced_at: null,   // null = pendiente de backfill de ventas
      status: 'active',
    }));

  // insertRows y no upsertRows: upsertRows hardcodea onConflict 'id', y la clave
  // natural acá es gm_client_id.
  if (nuevos.length) await insertRows('wholesale_clients', nuevos);
  result.imported = nuevos.length;

  // ── Actualizaciones: están en los dos lados ─────────────────────────────────
  for (const row of mirrorRows) {
    const local = existingBy.get(Number(row.id));
    if (!local) continue;

    const patch = {};
    if (row.name && row.name !== local.name) patch.name = row.name;
    if (row.phone && row.phone !== local.phone) {
      patch.phone = row.phone;
      patch.phone_normalized = row.phone_normalized;
    }
    if (row.email && row.email !== local.email) patch.email = row.email;
    if (local.gm_type_ok === false) patch.gm_type_ok = true;

    // Volvió a figurar como mayorista: si lo había archivado un import previo,
    // se reactiva. Un archivado a mano por el usuario no se toca.
    if (local.status === 'archived' && local.source === 'gm_auto' && local.gm_type_ok === false) {
      patch.status = 'active';
      result.restored++;
    }

    if (!Object.keys(patch).length) continue;

    const { error } = await supabase.from('wholesale_clients').update(patch).eq('id', local.id);
    if (error) throw new Error(error.message);
    result.updated++;
  }

  // ── Bajas: los que el import había traído y GM ya no devuelve ───────────────
  const bajas = linked.filter(c =>
    c.source === 'gm_auto' && c.status === 'active' && !inGm.has(Number(c.gm_client_id))
  );

  for (const c of bajas) {
    // Con seguimiento cargado no se archiva solo: se marca y decide el usuario.
    const { count, error: countErr } = await supabase
      .from('wholesale_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('wholesale_client_id', c.id);
    if (countErr) throw new Error(countErr.message);

    const patch = count ? { gm_type_ok: false } : { gm_type_ok: false, status: 'archived' };
    const { error } = await supabase.from('wholesale_clients').update(patch).eq('id', c.id);
    if (error) throw new Error(error.message);

    if (count) result.flagged++;
    else result.archived++;
  }

  await setSyncState({ clients_imported_at: syncedAt, clients_imported: result.total });

  console.log(
    `Import de mayoristas: ${result.total} en GM — ${result.imported} nuevos, ` +
    `${result.updated} actualizados, ${result.archived} archivados, ${result.flagged} marcados.`
  );

  return result;
}

// Corre el import cuidando que no haya dos a la vez. Devuelve null si ya hay uno.
async function runImportGuarded() {
  if (importInFlight) return null;
  importInFlight = true;
  try {
    return await importWholesaleClients();
  } finally {
    importInFlight = false;
  }
}

// Refresca todos los mayoristas activos, uno por uno. Asume que claimSync() ya
// corrió. Va siempre en background.
async function runSalesSync() {
  try {
    const settings = await getSettings();

    const clients = await fetchAllRows(() =>
      supabase.from('wholesale_clients').select('*').eq('status', 'active').order('name')
    );

    const linked = clients.filter(c => c.gm_client_id);

    if (linked.length === 0) {
      await setSyncState({ status: 'idle', finished_at: new Date().toISOString(), error: null });
      console.log('Sync de ventas mayoristas: no hay clientes vinculados a GM, nada que hacer.');
      return;
    }

    const to = todayStr();
    const from = addMonths(to, -(settings.history_months || 12));
    await setSyncState({ range_from: from, range_to: to, page: 0, total_pages: linked.length });
    console.log(`Sync de ventas mayoristas: ${linked.length} clientes, ventana ${from} → ${to}.`);

    let saved = 0;
    let scanned = 0;
    const failures = [];

    for (let i = 0; i < linked.length; i++) {
      const client = linked[i];
      try {
        const r = await refreshClientFromGm(client, settings);
        saved += r.sales_total;    // total sincronizado, es lo que muestra el panel
        scanned += r.sales_added;  // solo las nuevas de esta corrida
      } catch (err) {
        // Un cliente que falla no debe abortar el sync entero: se anota y sigue.
        const detail = err.response?.data?.message || err.message;
        console.error(`sync mayorista "${client.name}":`, detail);
        failures.push(`${client.name}: ${detail}`);
      }

      await setSyncState({
        page: i + 1,
        total_pages: linked.length,
        sales_scanned: scanned,
        sales_saved: saved,
      });
    }

    await setSyncState({
      status: failures.length === linked.length ? 'error' : 'idle',
      last_synced_to: to,
      finished_at: new Date().toISOString(),
      error: failures.length ? failures.slice(0, 5).join(' | ') : null,
    });
    console.log(`Sync de ventas mayoristas terminado: ${saved} ventas en ${linked.length} clientes${failures.length ? `, ${failures.length} con error` : ''}.`);
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    console.error('sync ventas mayoristas:', detail);
    // No se borra nada: el upsert es incremental, lo ya bajado queda servible.
    await setSyncState({ status: 'error', finished_at: new Date().toISOString(), error: detail });
  }
}

async function startSalesSyncInBackground() {
  const claimed = await claimSync();
  if (!claimed) return false;
  runSalesSync().catch(err => console.error('sync ventas mayoristas (background):', err.message));
  return true;
}

// ── Métricas ──────────────────────────────────────────────────────────────────
// Se calculan al leer, no se almacenan: son pocas decenas de mayoristas y unos
// miles de filas en wholesale_sales, así que agregarlas en Node es instantáneo.
function buildMetrics(sales, today) {
  const total_sales = sales.length;
  const total_units = sales.reduce((n, s) => n + (Number(s.items_sold) || 0), 0);
  const total_amount = sales.reduce((n, s) => n + (Number(s.total_price) || 0), 0);

  const dates = sales.map(s => s.date_sale).filter(Boolean).sort();
  const last_sale_date = dates.length ? dates[dates.length - 1] : null;

  // Frecuencia de compra: sólo tiene sentido con al menos 3 compras.
  let avg_days_between_purchases = null;
  if (dates.length >= 3) {
    const span = daysBetween(dates[0], dates[dates.length - 1]);
    avg_days_between_purchases = Math.max(1, Math.round(span / (dates.length - 1)));
  }

  return {
    total_sales,
    total_units,
    total_amount,
    avg_ticket: total_sales ? Math.round(total_amount / total_sales) : 0,
    avg_units_per_sale: total_sales ? Math.round(total_units / total_sales) : 0,
    last_sale_date,
    days_since_sale: last_sale_date ? daysBetween(last_sale_date, today) : null,
    avg_days_between_purchases,
  };
}

// Semáforo por días sin comprar. 'none' = nunca compró (o no está vinculado a GM).
function alertStatus(daysSinceSale, settings) {
  if (daysSinceSale == null) return 'none';
  if (daysSinceSale >= settings.alert_days) return 'alert';
  if (daysSinceSale >= settings.warn_days) return 'warn';
  return 'ok';
}

// Deja last_contact_date / next_contact_date del cliente en línea con su contacto
// más reciente. Se llama después de crear, editar o borrar un contacto.
async function refreshContactFields(clientId) {
  const { data, error } = await supabase
    .from('wholesale_contacts')
    .select('contacted_at, next_contact_date')
    .eq('wholesale_client_id', clientId)
    .order('contacted_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);

  const last = data[0] || null;
  const { error: updErr } = await supabase
    .from('wholesale_clients')
    .update({
      last_contact_date: last?.contacted_at || null,
      next_contact_date: last?.next_contact_date || null,
    })
    .eq('id', clientId);
  if (updErr) throw new Error(updErr.message);
}

// ── Clientes ──────────────────────────────────────────────────────────────────

// Ojo con el orden: /clients/search y /clients/import tienen que declararse ANTES
// que /clients/:id, si no Express matchea :id = 'search'.

// Trae de GM todos los clientes del tipo "Mayorista" y los espeja acá. Es
// síncrono porque cuesta 1 request a GM y corre en segundos. Si hubo altas,
// dispara además el backfill de ventas en background: el panel ya poletea
// /sales/sync-status, así que muestra el avance sin cambios.
router.post('/clients/import', async (_req, res) => {
  try {
    const result = await runImportGuarded();
    if (!result) return res.status(202).json({ already_running: true });

    const sync_started = result.imported > 0 ? await startSalesSyncInBackground() : false;
    res.json({ ...result, sync_started });
  } catch (err) {
    console.error('wholesale import:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/search', async (req, res) => {
  try {
    // Los metacaracteres de PostgREST (coma y paréntesis) romperían el .or().
    const q = String(req.query.q || '').trim().replace(/[,()]/g, ' ').trim();
    if (q.length < 2) return res.json({ results: [] });

    const digits = q.replace(/\D/g, '');
    const filters = [`name.ilike.%${q}%`];
    if (digits.length >= 4) filters.push(`phone_normalized.ilike.%${digits}%`);

    const { data, error } = await supabase
      .from('gm_clients')
      .select('id, name, phone')
      .or(filters.join(','))
      .order('name')
      .limit(30);
    if (error) throw new Error(error.message);

    // Marca los que ya son mayoristas para no permitir cargarlos dos veces.
    const ids = data.map(c => c.id);
    let already = new Set();
    if (ids.length) {
      const { data: existing, error: exErr } = await supabase
        .from('wholesale_clients')
        .select('gm_client_id')
        .in('gm_client_id', ids);
      if (exErr) throw new Error(exErr.message);
      already = new Set(existing.map(e => Number(e.gm_client_id)));
    }

    res.json({ results: data.map(c => ({ ...c, already_added: already.has(Number(c.id)) })) });
  } catch (err) {
    console.error('wholesale search:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients', async (req, res) => {
  try {
    const includeArchived = req.query.archived === '1';
    const today = todayStr();

    const [settings, syncState, clients, sales, contacts] = await Promise.all([
      getSettings(),
      getSyncState(),
      fetchAllRows(() => {
        const q = supabase.from('wholesale_clients').select('*');
        return (includeArchived ? q : q.eq('status', 'active')).order('name');
      }),
      fetchAllRows(() => supabase.from('wholesale_sales').select('*')),
      fetchAllRows(() =>
        supabase.from('wholesale_contacts').select('*')
          .order('contacted_at', { ascending: false })
          .order('id', { ascending: false })
      ),
    ]);

    const salesBy = {};
    for (const s of sales) (salesBy[s.gm_client_id] ||= []).push(s);

    const lastContactBy = {};
    for (const c of contacts) lastContactBy[c.wholesale_client_id] ||= c;

    const out = clients.map(c => {
      const metrics = buildMetrics(salesBy[c.gm_client_id] || [], today);
      return {
        ...c,
        metrics,
        alert_status: alertStatus(metrics.days_since_sale, settings),
        last_contact: lastContactBy[c.id] || null,
        contact_overdue: !!(c.next_contact_date && c.next_contact_date <= today),
        needs_sales_sync: !!(c.gm_client_id && !c.sales_synced_at),
      };
    });

    // El padrón de mayoristas se reimporta solo cuando pasó un día, igual que el
    // espejo de clientes de PostVenta. Va en background y sin await: la respuesta
    // sale con los datos que ya había y el próximo refresco muestra los nuevos.
    const lastImport = syncState.clients_imported_at;
    const importStale = !lastImport || Date.now() - new Date(lastImport).getTime() > IMPORT_STALE_MS;
    let import_started = false;

    if (settings.auto_import !== false && importStale && !importInFlight) {
      import_started = true;
      runImportGuarded().catch(err => console.error('auto-import mayoristas:', err.message));
    }

    res.json({ clients: out, settings, today, last_import_at: lastImport || null, import_started });
  } catch (err) {
    console.error('wholesale clients:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', async (req, res) => {
  const { gm_client_id, name, phone, email, assigned_to, tags, notes } = req.body;

  if (!gm_client_id && !name?.trim()) {
    return res.status(400).json({ error: 'El nombre es requerido.' });
  }

  try {
    let finalName = (name || '').trim();
    let finalPhone = (phone || '').trim() || null;
    let finalEmail = (email || '').trim() || null;

    if (gm_client_id) {
      const { data: dup, error: dupErr } = await supabase
        .from('wholesale_clients')
        .select('id, name')
        .eq('gm_client_id', gm_client_id)
        .maybeSingle();
      if (dupErr) throw new Error(dupErr.message);
      if (dup) return res.status(409).json({ error: `"${dup.name}" ya está cargado como mayorista.` });

      // Nombre y teléfono base salen del espejo del padrón (0 requests).
      const { data: mirror, error: gmErr } = await supabase
        .from('gm_clients')
        .select('name, phone')
        .eq('id', gm_client_id)
        .maybeSingle();
      if (gmErr) throw new Error(gmErr.message);

      finalName = finalName || (mirror?.name || '').trim();
      finalPhone = finalPhone || (mirror?.phone || '').trim() || null;

      // El email no está en el espejo (gm_clients no tiene esa columna) y el
      // teléfono puede estar vencido, así que se consulta GM en vivo. Es 1
      // request y evita que la ficha nazca incompleta. Si falla, se sigue igual
      // con lo del espejo: el botón ⟳ lo completa después.
      try {
        const gmContact = await lookupGmContact(gm_client_id, finalName);
        if (gmContact) {
          finalName = finalName || gmContact.name;
          if (gmContact.phone) finalPhone = gmContact.phone;
          if (gmContact.email) finalEmail = finalEmail || gmContact.email;
        }
      } catch (err) {
        console.warn('alta mayorista, lookup en GM falló:', err.message);
      }
    }

    if (!finalName) return res.status(400).json({ error: 'El nombre es requerido.' });

    const { data: client, error } = await supabase
      .from('wholesale_clients')
      .insert({
        gm_client_id: gm_client_id || null,
        name: finalName,
        phone: finalPhone,
        phone_normalized: normalizePhone(finalPhone),
        email: finalEmail,
        assigned_to: (assigned_to || '').trim() || null,
        tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [],
        notes: (notes || '').trim() || null,
        sales_synced_at: null,   // null = pendiente de backfill de ventas
        status: 'active',
        source: 'manual',        // el import por tipo no toca a los cargados a mano
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ ...client, needs_sales_sync: !!gm_client_id });
  } catch (err) {
    console.error('wholesale create client:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/:id', async (req, res) => {
  try {
    const id = +req.params.id;
    const today = todayStr();

    const { data: client, error } = await supabase
      .from('wholesale_clients')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    const [settings, sales, contacts] = await Promise.all([
      getSettings(),
      client.gm_client_id
        ? fetchAllRows(() =>
            supabase.from('wholesale_sales').select('*')
              .eq('gm_client_id', client.gm_client_id)
              .order('date_sale', { ascending: false, nullsFirst: false })
          )
        : Promise.resolve([]),
      fetchAllRows(() =>
        supabase.from('wholesale_contacts').select('*')
          .eq('wholesale_client_id', id)
          .order('contacted_at', { ascending: false })
          .order('id', { ascending: false })
      ),
    ]);

    const metrics = buildMetrics(sales, today);

    res.json({
      client: {
        ...client,
        metrics,
        alert_status: alertStatus(metrics.days_since_sale, settings),
        contact_overdue: !!(client.next_contact_date && client.next_contact_date <= today),
        needs_sales_sync: !!(client.gm_client_id && !client.sales_synced_at),
      },
      sales,
      contacts,
      settings,
      today,
    });
  } catch (err) {
    console.error('wholesale client detail:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/clients/:id', async (req, res) => {
  try {
    const id = +req.params.id;
    const patch = {};

    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
      patch.name = String(req.body.name).trim();
    }
    if (req.body.phone !== undefined) {
      patch.phone = String(req.body.phone).trim() || null;
      patch.phone_normalized = normalizePhone(patch.phone);
    }
    if (req.body.email !== undefined) patch.email = String(req.body.email).trim() || null;
    if (req.body.notes !== undefined) patch.notes = String(req.body.notes).trim() || null;
    if (req.body.assigned_to !== undefined) patch.assigned_to = String(req.body.assigned_to).trim() || null;
    if (req.body.tags !== undefined) {
      patch.tags = Array.isArray(req.body.tags) ? req.body.tags.map(t => String(t).trim()).filter(Boolean) : [];
    }
    if (req.body.status !== undefined) {
      if (!['active', 'archived'].includes(req.body.status)) {
        return res.status(400).json({ error: 'Estado inválido.' });
      }
      patch.status = req.body.status;
    }

    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

    const { data: client, error } = await supabase
      .from('wholesale_clients')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    res.json(client);
  } catch (err) {
    console.error('wholesale update client:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Borra el cliente definitivamente. Distinto de archivar (PATCH status), que lo
// esconde pero conserva todo: esto es para el que se cargó por error.
// Los contactos se van por el `on delete cascade` del schema.
router.delete('/clients/:id', async (req, res) => {
  try {
    const id = +req.params.id;
    const { data: client, error } = await supabase
      .from('wholesale_clients')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    // wholesale_sales no tiene FK (se cachea por gm_client_id), hay que limpiarla
    // a mano. gm_client_id es único, así que ningún otro mayorista las comparte.
    if (client.gm_client_id) {
      const { error: salesErr } = await supabase
        .from('wholesale_sales')
        .delete()
        .eq('gm_client_id', client.gm_client_id);
      if (salesErr) throw new Error(salesErr.message);
    }

    const { error: delErr } = await supabase.from('wholesale_clients').delete().eq('id', id);
    if (delErr) throw new Error(delErr.message);

    res.json({ ok: true });
  } catch (err) {
    console.error('wholesale delete client:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Trae de GM el teléfono y las ventas actualizadas de UN cliente. Síncrono:
// son ~2 requests, responde en pocos segundos.
router.post('/clients/:id/refresh', async (req, res) => {
  try {
    const id = +req.params.id;
    const today = todayStr();

    const { data: client, error } = await supabase
      .from('wholesale_clients')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (!client.gm_client_id) {
      return res.status(400).json({ error: 'Este cliente se cargó a mano y no está vinculado a Gestion Moda.' });
    }

    const settings = await getSettings();
    const summary = await refreshClientFromGm(client, settings);

    // Se relee todo para devolver la tarjeta ya actualizada y evitarle al
    // frontend un GET extra.
    const [fresh, sales, lastContact] = await Promise.all([
      supabase.from('wholesale_clients').select('*').eq('id', id).maybeSingle(),
      fetchAllRows(() =>
        supabase.from('wholesale_sales').select('*').eq('gm_client_id', client.gm_client_id)
      ),
      supabase.from('wholesale_contacts').select('*').eq('wholesale_client_id', id)
        .order('contacted_at', { ascending: false }).order('id', { ascending: false }).limit(1),
    ]);
    if (fresh.error) throw new Error(fresh.error.message);

    const metrics = buildMetrics(sales, today);

    res.json({
      summary,
      client: {
        ...fresh.data,
        metrics,
        alert_status: alertStatus(metrics.days_since_sale, settings),
        last_contact: lastContact.data?.[0] || null,
        contact_overdue: !!(fresh.data.next_contact_date && fresh.data.next_contact_date <= today),
        needs_sales_sync: false,
      },
    });
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    console.error('wholesale refresh client:', detail);
    res.status(500).json({ error: detail });
  }
});

// ── Contactos ─────────────────────────────────────────────────────────────────
router.post('/clients/:id/contacts', async (req, res) => {
  const { contacted_at, note, outcome, next_contact_date, seller } = req.body;

  if (outcome && !OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: 'Resultado de contacto inválido.' });
  }

  try {
    const id = +req.params.id;
    const { data: client, error } = await supabase
      .from('wholesale_clients')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    const { data: contact, error: insErr } = await supabase
      .from('wholesale_contacts')
      .insert({
        wholesale_client_id: id,
        contacted_at: contacted_at || todayStr(),
        note: (note || '').trim() || null,
        outcome: outcome || null,
        next_contact_date: next_contact_date || null,
        seller: (seller || '').trim() || null,
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    await refreshContactFields(id);

    res.json(contact);
  } catch (err) {
    console.error('wholesale create contact:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/contacts/:id', async (req, res) => {
  if (req.body.outcome && !OUTCOMES.includes(req.body.outcome)) {
    return res.status(400).json({ error: 'Resultado de contacto inválido.' });
  }

  try {
    const id = +req.params.id;
    const patch = {};
    if (req.body.contacted_at !== undefined) patch.contacted_at = req.body.contacted_at;
    if (req.body.note !== undefined) patch.note = String(req.body.note).trim() || null;
    if (req.body.outcome !== undefined) patch.outcome = req.body.outcome || null;
    if (req.body.next_contact_date !== undefined) patch.next_contact_date = req.body.next_contact_date || null;
    if (req.body.seller !== undefined) patch.seller = String(req.body.seller).trim() || null;

    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nada para actualizar.' });

    const { data: contact, error } = await supabase
      .from('wholesale_contacts')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    await refreshContactFields(contact.wholesale_client_id);

    res.json(contact);
  } catch (err) {
    console.error('wholesale update contact:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  try {
    const id = +req.params.id;
    const { data: contact, error } = await supabase
      .from('wholesale_contacts')
      .delete()
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    await refreshContactFields(contact.wholesale_client_id);

    res.json({ ok: true });
  } catch (err) {
    console.error('wholesale delete contact:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Sync de ventas ────────────────────────────────────────────────────────────
router.post('/sales/sync', async (_req, res) => {
  try {
    const state = await getSyncState();
    const running = state.status === 'running'
      && state.started_at
      && Date.now() - new Date(state.started_at).getTime() < SYNC_STUCK_MS;

    if (running) return res.status(202).json({ ...state, already_running: true });

    const started = await startSalesSyncInBackground();
    res.status(202).json({ ...(await getSyncState()), already_running: !started });
  } catch (err) {
    console.error('wholesale sales sync:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sales/sync-status', async (_req, res) => {
  try {
    const [state, pendingRes, countRes] = await Promise.all([
      getSyncState(),
      supabase.from('wholesale_clients').select('id', { count: 'exact', head: true })
        .eq('status', 'active').not('gm_client_id', 'is', null).is('sales_synced_at', null),
      supabase.from('wholesale_sales').select('id', { count: 'exact', head: true }),
    ]);
    if (pendingRes.error) throw new Error(pendingRes.error.message);
    if (countRes.error) throw new Error(countRes.error.message);

    res.json({
      ...state,
      pending_backfill: pendingRes.count || 0,
      total_sales: countRes.count || 0,
      last_import_at: state.clients_imported_at || null,
    });
  } catch (err) {
    console.error('wholesale sync-status:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Configuración ─────────────────────────────────────────────────────────────
router.get('/settings', async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (err) {
    console.error('wholesale settings:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/settings', async (req, res) => {
  try {
    const patch = {};
    for (const key of ['warn_days', 'alert_days', 'history_months']) {
      if (req.body[key] === undefined) continue;
      const n = Number(req.body[key]);
      if (!Number.isFinite(n) || n < 1) return res.status(400).json({ error: `${key} debe ser un número mayor a 0.` });
      patch[key] = Math.round(n);
    }
    if (req.body.sellers !== undefined) {
      patch.sellers = Array.isArray(req.body.sellers)
        ? [...new Set(req.body.sellers.map(s => String(s).trim()).filter(Boolean))]
        : [];
    }

    // Qué tipo(s) de cliente de GM se importan como mayoristas. No puede quedar
    // vacío: sin tipos el import archivaría a todo el mundo.
    if (req.body.gm_client_type_ids !== undefined) {
      const raw = Array.isArray(req.body.gm_client_type_ids)
        ? req.body.gm_client_type_ids
        : [req.body.gm_client_type_ids];
      const ids = [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n > 0).map(Math.round))];
      if (!ids.length) {
        return res.status(400).json({ error: 'Indicá al menos un tipo de cliente de Gestion Moda.' });
      }
      patch.gm_client_type_ids = ids;
    }

    if (req.body.auto_import !== undefined) patch.auto_import = !!req.body.auto_import;

    // Los umbrales que no vengan en el patch se validan contra los actuales.
    const current = await getSettings();
    const warn = patch.warn_days ?? current.warn_days;
    const alert = patch.alert_days ?? current.alert_days;
    if (alert <= warn) {
      return res.status(400).json({ error: 'El umbral rojo debe ser mayor al ámbar.' });
    }

    const { error } = await supabase
      .from('wholesale_settings')
      .upsert({ id: 1, ...patch }, { onConflict: 'id' });
    if (error) throw new Error(error.message);

    res.json(await getSettings());
  } catch (err) {
    console.error('wholesale update settings:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
