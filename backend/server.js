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

// Search client by name, verify by ID, return cellphone_number or phone_number
async function fetchClientPhone(clientId, clientName) {
  try {
    const { data } = await gm.get('/clientes', {
      params: { q: clientName, per_page: 50 },
    });
    const results = data.data || [];

    // Primary: exact ID match
    const match = results.find(c => c.id === clientId);
    if (match) {
      return (match.cellphone_number || match.phone_number || '').trim() || null;
    }

    // Fallback: single result with a phone (name search likely unambiguous)
    if (results.length === 1) {
      return (results[0].cellphone_number || results[0].phone_number || '').trim() || null;
    }

    // Fallback: try searching by ID directly via first-name only if full name failed
    const firstName = clientName.split(' ')[0];
    if (firstName && firstName !== clientName) {
      const { data: data2 } = await gm.get('/clientes', {
        params: { q: firstName, per_page: 50 },
      });
      const match2 = (data2.data || []).find(c => c.id === clientId);
      if (match2) {
        return (match2.cellphone_number || match2.phone_number || '').trim() || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// For sales missing a phone, search /clientes by name and verify by ID (batched, 10 at a time)
async function enrichPhonesFromClients(sales) {
  const noPhone = sales.filter(
    s => !(s.client?.cellphone_number || s.client?.phone_number || s.client_phone || '').trim() && s.client_id && s.client_name
  );

  if (noPhone.length === 0) return sales;

  // Deduplicate by client_id
  const uniqueClients = Object.values(
    Object.fromEntries(noPhone.map(s => [s.client_id, { id: s.client_id, name: s.client_name }]))
  );

  console.log(`Consultando teléfonos de ${uniqueClients.length} clientes sin teléfono...`);

  const phoneMap = {};
  const BATCH = 10;
  for (let i = 0; i < uniqueClients.length; i += BATCH) {
    const chunk = uniqueClients.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async ({ id, name }) => ({ id, phone: await fetchClientPhone(id, name) }))
    );
    for (const { id, phone } of results) {
      if (phone) phoneMap[id] = phone;
    }
  }

  return sales.map(s => {
    const existing = (s.client?.cellphone_number || s.client?.phone_number || s.client_phone || '').trim();
    if (existing) return s;
    return { ...s, client_phone: phoneMap[s.client_id] || null };
  });
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

    const rawSales = await fetchAllSales(params);
    const sales = await enrichPhonesFromClients(rawSales);
    const valid = sales.filter(s => s.client_name?.trim());

    if (valid.length === 0) {
      return res.status(404).json({ error: 'No se encontraron ventas con esos filtros en el período indicado.' });
    }

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
        client_phone: (s.client?.cellphone_number || s.client?.phone_number || s.client_phone || '').trim() || null,
        date_sale: s.date_sale,
        contacted: false,
        contacted_at: null,
      }))
    );

    res.json({ ...session, total_contacts: total, contacted_count: 0 });
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

    const noPhone = await fetchAllRows(() =>
      supabase
        .from('contacts')
        .select('id, client_id, client_name')
        .eq('session_id', id)
        .is('client_phone', null)
        .order('id')
    );

    if (noPhone.length === 0) return res.json({ updated: 0 });

    const uniqueClients = Object.values(
      Object.fromEntries(noPhone.map(c => [c.client_name, { id: c.client_id, name: c.client_name }]))
    );

    console.log(`Refrescando teléfonos: ${uniqueClients.length} clientes sin teléfono en sesión ${id}...`);

    const phoneMap = {};
    const BATCH = 10;
    for (let i = 0; i < uniqueClients.length; i += BATCH) {
      const chunk = uniqueClients.slice(i, i + BATCH);
      const results = await Promise.all(
        chunk.map(async ({ id: cid, name }) => ({ name, phone: await fetchClientPhone(cid, name) }))
      );
      for (const { name, phone } of results) {
        if (phone) phoneMap[name] = phone;
      }
    }

    let updated = 0;
    for (const [clientName, phone] of Object.entries(phoneMap)) {
      const { data: rows, error: upErr } = await supabase
        .from('contacts')
        .update({ client_phone: phone })
        .eq('session_id', id)
        .eq('client_name', clientName)
        .is('client_phone', null)
        .select('id');
      if (upErr) throw new Error(upErr.message);
      updated += rows.length;
    }

    res.json({ updated, total_sin_telefono: noPhone.length });
  } catch (err) {
    console.error('refresh phones:', err.message);
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
