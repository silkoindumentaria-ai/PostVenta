// Cliente de Gestion Moda con cola de rate limit.
// IMPORTANTE: toda llamada a GM debe pasar por la instancia `gm` que exporta este
// módulo. Crear otro cliente axios se saltea la cola y devuelve 429.
require('dotenv').config();
const axios = require('axios');

const gm = axios.create({
  baseURL: 'https://gestion.moda/api/v1',
  headers: {
    Authorization: `Bearer ${process.env.GM_TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ── Rate limit ────────────────────────────────────────────────────────────────
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

// ── Ventas ────────────────────────────────────────────────────────────────────
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

// ── Consultas por cliente ─────────────────────────────────────────────────────
// OJO con la diferencia entre las dos rutas de ventas:
//   /ventas/obtener  → NO permite filtrar por cliente (solo from/to/channel/store)
//   /ventas          → acepta `search`, que matchea por cliente, número, email,
//                      factura o comentario, y SÍ maneja bien la ñ y los acentos
// Por eso las ventas de un mayorista se traen con /ventas?search=<nombre>: son
// 1-2 requests en vez de escanear meses enteros de ventas de todo el negocio.

// 'MUÑOZ' → 'MUNOZ'. NFD separa el diacrítico de la letra base y el rango
// ̀-ͯ lo elimina. Necesario porque GM tiene los nombres guardados con
// el encoding roto: q=MUÑOZ devuelve 0 resultados, q=MUNOZ devuelve decenas.
function foldAccents(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Busca clientes en el padrón de GM. Devuelve el array crudo (con cellphone_number).
async function searchGmClients(q) {
  const { data } = await gm.get('/clientes', { params: { q, per_page: 200 } });
  return data.data || [];
}

// Todas las ventas que matchean `search`, opcionalmente acotadas por fecha.
// include_details va en 0 a propósito: items_sold, items_lines, total_price,
// channel, store, budget y active vienen igual, con un payload mucho más chico.
async function fetchClientSales(search, { from, to } = {}) {
  const all = [];
  let page = 1;

  for (;;) {
    const { data } = await gm.get('/ventas', {
      params: { search, from, to, per_page: 200, page, include_details: 0, include_payments: 0 },
    });

    all.push(...(data.data || []));

    const lastPage = data.meta?.last_page || page;
    if (!data.meta?.has_more_pages || page >= lastPage || page >= 20) break;
    page++;
  }

  return all;
}

module.exports = { gm, fetchAllSales, searchGmClients, fetchClientSales, foldAccents, sleep };
