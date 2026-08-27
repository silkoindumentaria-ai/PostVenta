require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ── Supabase (base de datos) ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en las variables de entorno.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// PostgREST devuelve máximo 1000 filas por request; esto pagina hasta traer todo.
// buildQuery debe devolver una query NUEVA en cada llamada (no son reutilizables).
const SB_PAGE = 1000;
async function fetchAllRows(buildQuery) {
  const all = [];
  for (let from = 0; ; from += SB_PAGE) {
    const { data, error } = await buildQuery().range(from, from + SB_PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < SB_PAGE) break;
  }
  return all;
}

async function insertRows(table, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + chunk));
    if (error) throw new Error(error.message);
  }
}

async function upsertRows(table, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + chunk), { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
}

// Normaliza un teléfono argentino al formato 549XXXXXXXXXX (misma lógica que
// formatPhoneForWhatsApp en frontend/src/components/ContactsTable.jsx) para
// poder matchear el mismo cliente real entre sesiones y fuentes distintas.
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0') && d.length > 10) d = d.slice(1);
  if (d.startsWith('54')) {
    if (!d.startsWith('549') && d.length >= 12) d = '549' + d.slice(2);
    return d;
  }
  return '549' + d;
}

// ── Gestion Moda client ───────────────────────────────────────────────────────
const gm = axios.create({
  baseURL: 'https://gestion.moda/api/v1',
  headers: {
    Authorization: `Bearer ${process.env.GM_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ── Rate limit de Gestion Moda ────────────────────────────────────────────────
// La API responde X-RateLimit-Limit: 60, y el contador es COMPARTIDO entre todos
// los endpoints (/ventas y /clientes descuentan del mismo bucket). Se limita a 50
// por minuto para dejar margen. Es una cola FIFO única a nivel módulo, así que
// cubre también requests concurrentes de endpoints distintos.
const GM_MAX_PER_WINDOW = 50;
const GM_WINDOW_MS = 60_000;

const gmTimestamps = [];   // momentos de los requests dentro de la ventana actual
let gmQueue = Promise.resolve();

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Espera un turno respetando la ventana deslizante. Serializado por gmQueue para
// que dos requests en paralelo no reserven el mismo turno.
function gmAcquireSlot() {
  const turn = gmQueue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (gmTimestamps.length && now - gmTimestamps[0] >= GM_WINDOW_MS) gmTimestamps.shift();
      if (gmTimestamps.length < GM_MAX_PER_WINDOW) {
        gmTimestamps.push(now);
        return;
      }
      await sleep(GM_WINDOW_MS - (now - gmTimestamps[0]) + 50);
    }
  });
  // La cola no debe romperse si un turno falla.
  gmQueue = turn.catch(() => {});
  return turn;
}

gm.interceptors.request.use(async config => {
  await gmAcquireSlot();
  return config;
});

// Reintenta ante 429/503 respetando Retry-After. Loguea cuando queda poco margen.
const GM_MAX_RETRIES = 3;

gm.interceptors.response.use(
  response => {
    const remaining = Number(response.headers['x-ratelimit-remaining']);
    if (Number.isFinite(remaining) && remaining < 10) {
      console.warn(`GM rate limit: quedan ${remaining} requests en la ventana actual`);
    }
    return response;
  },
  async error => {
    const { config, response } = error;
    const status = response?.status;
    if (!config || (status !== 429 && status !== 503)) return Promise.reject(error);

    config.__gmRetries = (config.__gmRetries || 0) + 1;
    if (config.__gmRetries > GM_MAX_RETRIES) return Promise.reject(error);

    const retryAfter = Number(response.headers?.['retry-after']);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : GM_WINDOW_MS * config.__gmRetries;

    console.warn(`GM ${status} — reintento ${config.__gmRetries}/${GM_MAX_RETRIES} en ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
    return gm.request(config);
  }
);

// ── Tienda Nube client ────────────────────────────────────────────────────────
const tn = axios.create({
  baseURL: `https://api.tiendanube.com/v1/${process.env.TN_STORE_ID}`,
  headers: {
    Authentication: `bearer ${process.env.TN_ACCESS_TOKEN}`,
    'User-Agent': 'SilkoPostVenta (gabrieldecima1028@gmail.com)',
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

async function fetchAllTNOrders(params) {
  const all = [];
  let page = 1;
  while (true) {
    const { data } = await tn.get('/orders', {
      params: { ...params, per_page: 200, page },
    });
    all.push(...data);
    if (data.length < 200 || page >= 50) break;
    page++;
  }
  return all;
}

async function fetchAllSales(params) {
  const all = [];
  let page = 1;
  while (true) {
    const { data } = await gm.get('/ventas/obtener', {
      params: { ...params, per_page: 200, page, include_details: 0, include_payments: 0 },
    });
    all.push(...data.data);
    if (!data.meta.has_more_pages || page >= data.meta.last_page || page >= 50) break;
    page++;
  }
  return all;
}

// ── Espejo del padrón de clientes de GM ───────────────────────────────────────
// GET /ventas/obtener NO devuelve el celular: el sub-objeto `client` solo trae
// phone_number (casi siempre vacío) y no existe GET /clientes/{id}. Buscar por
// nombre tampoco sirve: GM tiene los nombres con encoding roto, así que q=MUÑOZ
// devuelve 0 resultados. La solución es bajar el padrón completo (27.5k clientes
// ≈ 138 páginas) a la tabla gm_clients y cruzar localmente por client_id.
const GM_CLIENTS_PER_PAGE = 200;
const SYNC_STALE_MS = 24 * 60 * 60 * 1000;   // el espejo se considera vencido a las 24 h
const SYNC_STUCK_MS = 15 * 60 * 1000;        // un 'running' más viejo que esto se da por muerto

async function getSyncState() {
  const { data, error } = await supabase
    .from('gm_sync_state')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || { id: 1, status: 'idle', page: 0, total_pages: 0, clients_synced: 0 };
}

async function setSyncState(patch) {
  const { error } = await supabase.from('gm_sync_state').upsert({ id: 1, ...patch }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

function clientRowFromGm(c) {
  const phone = (c.cellphone_number || c.phone_number || '').trim() || null;
  return {
    id: c.id,
    name: (c.name || '').trim() || null,
    phone,
    phone_normalized: normalizePhone(phone),
    active: c.active !== false,
    synced_at: new Date().toISOString(),
  };
}

// Marca el sync como 'running' antes de arrancar. Devuelve false si ya hay uno
// en curso. Se hace en un paso aparte y con await para que el endpoint que lo
// dispara responda recién cuando el estado ya está escrito: si no, el frontend
// poletea, lee 'idle', y se queda esperando un sync que "todavía no arrancó".
async function claimSync() {
  const state = await getSyncState();
  if (state.status === 'running' && state.started_at && Date.now() - new Date(state.started_at).getTime() < SYNC_STUCK_MS) {
    console.log('Sync de clientes ya en curso, se ignora el pedido.');
    return false;
  }

  await setSyncState({
    status: 'running',
    page: 0,
    total_pages: 0,
    clients_synced: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
  });

  return true;
}

// Baja todo el padrón paginado y lo upsertea. Asume que claimSync() ya corrió.
// Tarda ~3 min por el throttle de 50 req/min, así que va siempre en background.
async function runSyncPages() {
  console.log('Sincronizando padrón de clientes de Gestion Moda...');

  try {
    let page = 1;
    let synced = 0;
    let lastPage = 1;

    for (;;) {
      const { data } = await gm.get('/clientes', {
        params: { per_page: GM_CLIENTS_PER_PAGE, page },
      });

      // Dedupe por id: si dos páginas repiten un cliente, el upsert falla con
      // "ON CONFLICT DO UPDATE command cannot affect row a second time".
      const rows = Object.values(
        Object.fromEntries((data.data || []).map(c => [c.id, clientRowFromGm(c)]))
      );
      if (rows.length) await upsertRows('gm_clients', rows);

      synced += rows.length;
      lastPage = data.meta?.last_page || page;

      await setSyncState({ page, total_pages: lastPage, clients_synced: synced });

      if (!data.meta?.has_more_pages || page >= lastPage) break;
      page++;
    }

    await setSyncState({ status: 'idle', finished_at: new Date().toISOString(), error: null });
    console.log(`Sync de clientes terminado: ${synced} clientes en ${lastPage} páginas.`);
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    console.error('sync clientes:', detail);
    // No se borra nada: el upsert es incremental, lo ya sincronizado queda servible.
    await setSyncState({ status: 'error', finished_at: new Date().toISOString(), error: detail });
  }
}

// Reserva el turno (await, rápido) y deja el recorrido de páginas corriendo solo.
// Devuelve true si efectivamente arrancó un sync nuevo.
async function startSyncInBackground() {
  const claimed = await claimSync();
  if (!claimed) return false;
  runSyncPages().catch(err => console.error('sync clientes (background):', err.message));
  return true;
}

// true si el espejo está vacío o su fila más reciente tiene más de 24 h.
async function isSyncStale() {
  const { data, error } = await supabase
    .from('gm_clients')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return true;
  return Date.now() - new Date(data.synced_at).getTime() > SYNC_STALE_MS;
}

// Cruza client_ids contra el espejo. Devuelve { [client_id]: phone }. 0 requests a GM.
const LOOKUP_CHUNK = 300;   // ids por request, para no pasarse del largo de URL de PostgREST

async function lookupPhones(clientIds) {
  const ids = [...new Set(clientIds.filter(Boolean).map(Number))];
  const phoneMap = {};

  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const chunk = ids.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from('gm_clients')
      .select('id, phone')
      .in('id', chunk);
    if (error) throw new Error(error.message);
    for (const row of data) {
      if (row.phone) phoneMap[row.id] = row.phone;
    }
  }

  return phoneMap;
}

// Inserta la sesión y sus contactos; si fallan los contactos borra la sesión
// para no dejar una sesión vacía huérfana.
async function createSessionWithContacts(sessionRow, buildContacts) {
  const { data: session, error } = await supabase
    .from('sessions')
    .insert(sessionRow)
    .select()
    .single();
  if (error) throw new Error(error.message);

  const contactRows = buildContacts(session.id);
  try {
    await insertRows('contacts', contactRows);
  } catch (err) {
    await supabase.from('sessions').delete().eq('id', session.id);
    throw err;
  }

  return { session, total: contactRows.length };
}

// ── Health check (para monitores de uptime / evitar spin-down en Render) ─────
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── Tienda Nube sessions ──────────────────────────────────────────────────────
app.post('/api/tn/sessions', async (req, res) => {
  const { name, date_from, date_to, whatsapp_message } = req.body;

  if (!name?.trim() || !date_from || !date_to) {
    return res.status(400).json({ error: 'Nombre, fecha_desde y fecha_hasta son requeridos.' });
  }
  if (date_from > date_to) {
    return res.status(400).json({ error: 'La fecha desde debe ser anterior a la fecha hasta.' });
  }

  try {
    const orders = await fetchAllTNOrders({
      payment_status: 'paid',
      created_at_min: date_from,
      created_at_max: date_to + 'T23:59:59+0000',
      fields: 'id,number,created_at,contact_name,contact_phone,contact_email,customer',
    });

    const valid = orders.filter(o => o.contact_name?.trim());

    if (valid.length === 0) {
      return res.status(404).json({ error: 'No se encontraron órdenes pagas en ese período.' });
    }

    const msg = whatsapp_message?.trim() ||
      'Hola [Nombre], ¿cómo estás? Nos contactamos desde Silko para consultarte sobre tu reciente compra.';

    const seen = new Set();
    const unique = valid.filter(o => (seen.has(o.id) ? false : seen.add(o.id)));

    const { session, total } = await createSessionWithContacts(
      {
        name: name.trim(),
        source: 'tn',
        channel_id: null,
        channel_name: 'Tienda Nube',
        store_id: null,
        store_name: null,
        date_from,
        date_to,
        whatsapp_message: msg,
        status: 'active',
      },
      sessionId => unique.map(o => ({
        session_id: sessionId,
        sale_id: o.id,
        client_id: o.customer?.id || null,
        client_name: o.contact_name.trim(),
        client_phone: (o.contact_phone || o.customer?.phone || '').trim() || null,
        date_sale: o.created_at ? o.created_at.split('T')[0] : date_from,
        contacted: false,
        contacted_at: null,
      }))
    );

    res.json({ ...session, total_contacts: total, contacted_count: 0 });
  } catch (err) {
    const detail = err.response?.data?.description || err.response?.data?.message || err.message;
    console.error('tn session error:', err.response?.status, detail);
    res.status(500).json({ error: detail });
  }
});

// ── Channels & Stores ─────────────────────────────────────────────────────────
app.get('/api/channels-stores', async (req, res) => {
  try {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 180);

    const { data } = await gm.get('/ventas/obtener', {
      params: {
        from: from.toISOString().split('T')[0],
        to: today.toISOString().split('T')[0],
        per_page: 200,
      },
    });

    const channels = {};
    const stores = {};
    for (const s of data.data) {
      if (s.channel_id && s.channel) channels[s.channel_id] = s.channel;
      if (s.store_id && s.store) stores[s.store_id] = s.store;
    }

    res.json({
      channels: Object.entries(channels).map(([id, name]) => ({ id: +id, name })),
      stores: Object.entries(stores).map(([id, name]) => ({ id: +id, name })),
    });
  } catch (err) {
    console.error('channels-stores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────
app.get('/api/sessions', async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const withCounts = await Promise.all(
      sessions.map(async s => {
        const [totalRes, contactedRes] = await Promise.all([
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('session_id', s.id),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('session_id', s.id).eq('contacted', true),
        ]);
        if (totalRes.error) throw new Error(totalRes.error.message);
        if (contactedRes.error) throw new Error(contactedRes.error.message);
        return { ...s, total_contacts: totalRes.count || 0, contacted_count: contactedRes.count || 0 };
      })
    );

    res.json(withCounts);
  } catch (err) {
    console.error('list sessions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  const { name, channel_id, store_id, date_from, date_to, whatsapp_message } = req.body;

  if (!name?.trim() || !date_from || !date_to) {
    return res.status(400).json({ error: 'Nombre, fecha_desde y fecha_hasta son requeridos.' });
  }
  if (date_from > date_to) {
    return res.status(400).json({ error: 'La fecha desde debe ser anterior a la fecha hasta.' });
  }

  try {
    const params = { from: date_from, to: date_to };
    if (channel_id) params.channel_id = channel_id;
    if (store_id) params.store_id = store_id;

    const sales = await fetchAllSales(params);
    const valid = sales.filter(s => s.client_name?.trim());

    if (valid.length === 0) {
      return res.status(404).json({ error: 'No se encontraron ventas con esos filtros en el período indicado.' });
    }

    // Los teléfonos salen del espejo local (0 requests a GM). Si está vencido se
    // resincroniza en background y la sesión se crea con lo que haya.
    const phoneMap = await lookupPhones(valid.map(s => s.client_id));
    const stale = await isSyncStale();
    const syncStarted = stale ? await startSyncInBackground() : false;

    const msg = whatsapp_message?.trim() ||
      'Hola [Nombre], ¿cómo estás? Nos contactamos desde Silko para consultarte sobre tu reciente compra.';

    // Deduplicate by sale_id within the same session
    const seen = new Set();
    const unique = valid.filter(s => (seen.has(s.id) ? false : seen.add(s.id)));

    const { session, total } = await createSessionWithContacts(
      {
        name: name.trim(),
        source: 'gm',
        channel_id: channel_id || null,
        channel_name: valid[0]?.channel || null,
        store_id: store_id || null,
        store_name: valid[0]?.store || null,
        date_from,
        date_to,
        whatsapp_message: msg,
        status: 'active',
      },
      sessionId => unique.map(s => ({
        session_id: sessionId,
        sale_id: s.id,
        client_id: s.client_id || null,
        client_name: s.client_name.trim(),
        client_phone: phoneMap[s.client_id] || (s.client?.phone_number || '').trim() || null,
        date_sale: s.date_sale,
        contacted: false,
        contacted_at: null,
      }))
    );

    res.json({ ...session, total_contacts: total, contacted_count: 0, sync_started: syncStarted });
  } catch (err) {
    console.error('create session:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

app.get('/api/sessions/:id/contacts', async (req, res) => {
  try {
    const id = +req.params.id;
    const { data: session, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    const contacts = await fetchAllRows(() =>
      supabase
        .from('contacts')
        .select('*')
        .eq('session_id', id)
        .order('date_sale', { ascending: false, nullsFirst: false })
        .order('client_name', { ascending: true })
        .order('id', { ascending: true })
    );

    res.json({ session, contacts });
  } catch (err) {
    console.error('session contacts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions/:id/refresh-phones', async (req, res) => {
  try {
    const id = +req.params.id;
    const { data: session, error } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

    // Se traen las filas completas para poder actualizarlas con un upsert en
    // lote (un request cada 500) en vez de un UPDATE por cada teléfono distinto.
    const noPhone = await fetchAllRows(() =>
      supabase
        .from('contacts')
        .select('*')
        .eq('session_id', id)
        .is('client_phone', null)
        .order('id')
    );

    if (noPhone.length === 0) return res.json({ updated: 0, total_sin_telefono: 0, sync_started: false });

    // Si el espejo está vencido (o vacío) se resincroniza en background: el
    // usuario puede volver a apretar el botón cuando termine.
    const stale = await isSyncStale();
    const syncStarted = stale ? await startSyncInBackground() : false;

    console.log(`Refrescando teléfonos: ${noPhone.length} contactos sin teléfono en sesión ${id}...`);

    const phoneMap = await lookupPhones(noPhone.map(c => c.client_id));

    // El teléfono se asigna por client_id, no por nombre: dos clientes distintos
    // pueden llamarse igual y compartir teléfono sería un error.
    const toUpdate = noPhone
      .filter(c => phoneMap[c.client_id])
      .map(c => ({ ...c, client_phone: phoneMap[c.client_id] }));

    if (toUpdate.length) await upsertRows('contacts', toUpdate);

    res.json({ updated: toUpdate.length, total_sin_telefono: noPhone.length, sync_started: syncStarted });
  } catch (err) {
    console.error('refresh phones:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Padrón de clientes (espejo de GM) ─────────────────────────────────────────
app.post('/api/clients/sync', async (_req, res) => {
  try {
    const state = await getSyncState();
    const running = state.status === 'running'
      && state.started_at
      && Date.now() - new Date(state.started_at).getTime() < SYNC_STUCK_MS;

    if (running) return res.status(202).json({ ...state, already_running: true });

    const started = await startSyncInBackground();
    res.status(202).json({ ...(await getSyncState()), already_running: !started });
  } catch (err) {
    console.error('clients sync:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/sync-status', async (_req, res) => {
  try {
    const [state, countRes, lastRes] = await Promise.all([
      getSyncState(),
      supabase.from('gm_clients').select('id', { count: 'exact', head: true }),
      supabase.from('gm_clients').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (countRes.error) throw new Error(countRes.error.message);
    if (lastRes.error) throw new Error(lastRes.error.message);

    const syncedAt = lastRes.data?.synced_at || null;

    res.json({
      ...state,
      total_clients: countRes.count || 0,
      synced_at: syncedAt,
      stale: !syncedAt || Date.now() - new Date(syncedAt).getTime() > SYNC_STALE_MS,
    });
  } catch (err) {
    console.error('clients sync-status:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/finish', async (req, res) => {
  try {
    const id = +req.params.id;
    const { data: rows, error } = await supabase
      .from('sessions')
      .update({ status: 'finished' })
      .eq('id', id)
      .select('id');
    if (error) throw new Error(error.message);
    if (rows.length === 0) return res.status(404).json({ error: 'Sesión no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('finish session:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Contacts ──────────────────────────────────────────────────────────────────
app.patch('/api/contacts/:id', async (req, res) => {
  try {
    const id = +req.params.id;
    const contacted = !!req.body.contacted;
    const contacted_at = contacted ? new Date().toISOString() : null;

    const { data: contact, error } = await supabase
      .from('contacts')
      .update({ contacted, contacted_at })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    if (contacted) {
      const { data: session } = await supabase
        .from('sessions')
        .select('name, source')
        .eq('id', contact.session_id)
        .maybeSingle();

      const { error: logErr } = await supabase.from('contact_logs').insert({
        contact_id: contact.id,
        session_id: contact.session_id,
        session_name: session?.name || '(sesión eliminada)',
        source: session?.source || 'gm',
        client_id: contact.client_id,
        client_name: contact.client_name,
        client_phone_raw: contact.client_phone,
        client_phone_normalized: normalizePhone(contact.client_phone),
        message: (req.body.message || '').trim(),
        contacted_at,
      });
      if (logErr) throw new Error(logErr.message);
    }
    // Destildar solo cambia el estado actual; el historial en contact_logs nunca se borra.

    res.json(contact);
  } catch (err) {
    console.error('toggle contact:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contacts/:id/history', async (req, res) => {
  try {
    const id = +req.params.id;
    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    const normalizedPhone = normalizePhone(contact.client_phone);
    let query = supabase.from('contact_logs').select('*');

    if (normalizedPhone) {
      query = query.eq('client_phone_normalized', normalizedPhone);
    } else if (contact.client_id) {
      const { data: session } = await supabase
        .from('sessions')
        .select('source')
        .eq('id', contact.session_id)
        .maybeSingle();
      query = query.eq('client_id', contact.client_id).eq('source', session?.source || 'gm');
    } else {
      query = query.eq('contact_id', contact.id);
    }

    const { data: entries, error: logErr } = await query.order('contacted_at', { ascending: false });
    if (logErr) throw new Error(logErr.message);

    res.json({ client_name: contact.client_name, client_phone: contact.client_phone, entries });
  } catch (err) {
    console.error('contact history:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Static (producción) ───────────────────────────────────────────────────────
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend no compilado. Ejecutá: cd frontend && npm run build');
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`PostVenta backend corriendo en http://localhost:${PORT}`));
