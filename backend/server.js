require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ── JSON Database ─────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'postventa.json');

function loadDb() {
  if (fs.existsSync(DB_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch { /* corrupt file → start fresh */ }
  }
  return { sessions: [], contacts: [], nextSessionId: 1, nextContactId: 1 };
}

function saveDb(db) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_PATH);
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
    s => !(s.client?.phone_number || s.client_phone || '').trim() && s.client_id && s.client_name
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
    const existing = (s.client?.phone_number || s.client_phone || '').trim();
    if (existing) return s;
    return { ...s, client_phone: phoneMap[s.client_id] || null };
  });
}

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

    const db = loadDb();

    const session = {
      id: db.nextSessionId++,
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
      created_at: new Date().toISOString(),
    };
    db.sessions.push(session);

    const seenIds = new Set();
    for (const o of valid) {
      if (seenIds.has(o.id)) continue;
      seenIds.add(o.id);
      const phone = (o.contact_phone || o.customer?.phone || '').trim() || null;
      const dateOnly = o.created_at ? o.created_at.split('T')[0] : date_from;
      db.contacts.push({
        id: db.nextContactId++,
        session_id: session.id,
        sale_id: o.id,
        client_id: o.customer?.id || null,
        client_name: o.contact_name.trim(),
        client_phone: phone,
        date_sale: dateOnly,
        contacted: false,
        contacted_at: null,
      });
    }

    saveDb(db);
    res.json({ ...session, total_contacts: seenIds.size, contacted_count: 0 });
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
app.get('/api/sessions', (req, res) => {
  const db = loadDb();
  const active = db.sessions
    .filter(s => s.status === 'active')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(s => {
      const sessionContacts = db.contacts.filter(c => c.session_id === s.id);
      return {
        ...s,
        total_contacts: sessionContacts.length,
        contacted_count: sessionContacts.filter(c => c.contacted).length,
      };
    });
  res.json(active);
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

    const db = loadDb();

    const session = {
      id: db.nextSessionId++,
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
      created_at: new Date().toISOString(),
    };
    db.sessions.push(session);

    // Deduplicate by sale_id within the same session
    const seenSaleIds = new Set();
    for (const s of valid) {
      if (seenSaleIds.has(s.id)) continue;
      seenSaleIds.add(s.id);
      const phone = (s.client?.phone_number || s.client_phone || '').trim() || null;
      db.contacts.push({
        id: db.nextContactId++,
        session_id: session.id,
        sale_id: s.id,
        client_id: s.client_id || null,
        client_name: s.client_name.trim(),
        client_phone: phone,
        date_sale: s.date_sale,
        contacted: false,
        contacted_at: null,
      });
    }

    saveDb(db);

    res.json({ ...session, total_contacts: seenSaleIds.size, contacted_count: 0 });
  } catch (err) {
    console.error('create session:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

app.get('/api/sessions/:id/contacts', (req, res) => {
  const db = loadDb();
  const id = +req.params.id;
  const session = db.sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });

  const contacts = db.contacts
    .filter(c => c.session_id === id)
    .sort((a, b) => {
      if (b.date_sale !== a.date_sale) return b.date_sale.localeCompare(a.date_sale);
      return a.client_name.localeCompare(b.client_name);
    });

  res.json({ session, contacts });
});

app.patch('/api/sessions/:id/finish', (req, res) => {
  const db = loadDb();
  const id = +req.params.id;
  const session = db.sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
  session.status = 'finished';
  saveDb(db);
  res.json({ ok: true });
});

// ── Contacts ──────────────────────────────────────────────────────────────────
app.patch('/api/contacts/:id', (req, res) => {
  const db = loadDb();
  const id = +req.params.id;
  const contact = db.contacts.find(c => c.id === id);
  if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });
  contact.contacted = !!req.body.contacted;
  contact.contacted_at = contact.contacted ? new Date().toISOString() : null;
  saveDb(db);
  res.json(contact);
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
