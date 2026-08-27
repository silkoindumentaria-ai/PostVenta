// Cliente de Supabase y helpers de acceso a datos.
// Se importa como módulo para que backend/server.js y backend/wholesale.js
// compartan una sola instancia (el caché de módulos de Node lo garantiza).
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

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
// formatPhoneForWhatsApp en frontend/src/utils/phone.js) para poder matchear el
// mismo cliente real entre sesiones y fuentes distintas.
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

module.exports = { supabase, fetchAllRows, insertRows, upsertRows, normalizePhone };
