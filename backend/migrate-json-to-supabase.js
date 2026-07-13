// Migra los datos de postventa.json a Supabase, conservando los IDs originales.
//
// Uso:
//   node migrate-json-to-supabase.js [ruta-al-json]
//
// Sin argumento usa ./postventa.json. Requiere SUPABASE_URL y SUPABASE_SERVICE_KEY
// en backend/.env. Aborta si ya hay datos en Supabase para no duplicar.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en backend/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const jsonPath = process.argv[2] || path.join(__dirname, 'postventa.json');

const clean = v => (typeof v === 'string' && v.trim() === '' ? null : v ?? null);

async function insertChunked(table, rows, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + chunk));
    if (error) {
      throw new Error(`Error insertando en ${table} (fila ~${i}): ${error.message}`);
    }
    console.log(`  ${table}: ${Math.min(i + chunk, rows.length)}/${rows.length}`);
  }
}

async function main() {
  if (!fs.existsSync(jsonPath)) {
    console.error(`No existe el archivo: ${jsonPath}`);
    process.exit(1);
  }

  const db = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const sessions = db.sessions || [];
  const contacts = db.contacts || [];
  const contactLogs = db.contactLogs || [];

  console.log(`Archivo: ${jsonPath}`);
  console.log(`A migrar: ${sessions.length} sesiones, ${contacts.length} contactos, ${contactLogs.length} logs de historial\n`);

  // Guard: no duplicar si ya hay datos
  const { count, error: countErr } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true });
  if (countErr) {
    console.error(`No se pudo consultar Supabase: ${countErr.message}`);
    console.error('¿Ejecutaste supabase-schema.sql en el SQL Editor?');
    process.exit(1);
  }
  if (count > 0) {
    console.error(`La tabla sessions ya tiene ${count} filas. Abortando para no duplicar datos.`);
    console.error('Si querés reimportar desde cero, ejecutá en el SQL Editor de Supabase:');
    console.error('  truncate contact_logs, contacts, sessions restart identity cascade;');
    process.exit(1);
  }

  await insertChunked('sessions', sessions.map(s => ({
    id: s.id,
    name: s.name,
    source: s.source || 'gm',
    channel_id: s.channel_id ?? null,
    channel_name: clean(s.channel_name),
    store_id: s.store_id ?? null,
    store_name: clean(s.store_name),
    date_from: s.date_from,
    date_to: s.date_to,
    whatsapp_message: clean(s.whatsapp_message),
    status: s.status || 'active',
    created_at: s.created_at || new Date().toISOString(),
  })));

  await insertChunked('contacts', contacts.map(c => ({
    id: c.id,
    session_id: c.session_id,
    sale_id: c.sale_id ?? null,
    client_id: c.client_id ?? null,
    client_name: c.client_name,
    client_phone: clean(c.client_phone),
    date_sale: clean(c.date_sale),
    contacted: !!c.contacted,
    contacted_at: clean(c.contacted_at),
  })));

  await insertChunked('contact_logs', contactLogs.map(l => ({
    id: l.id,
    contact_id: l.contact_id ?? null,
    session_id: l.session_id ?? null,
    session_name: clean(l.session_name),
    source: l.source || 'gm',
    client_id: l.client_id ?? null,
    client_name: clean(l.client_name),
    client_phone_raw: clean(l.client_phone_raw),
    client_phone_normalized: clean(l.client_phone_normalized),
    message: clean(l.message),
    contacted_at: clean(l.contacted_at),
  })));

  // Ajustar las secuencias para que los próximos IDs no colisionen con los importados
  const { error: rpcErr } = await supabase.rpc('reset_id_sequences');
  if (rpcErr) throw new Error(`Error ajustando secuencias: ${rpcErr.message}`);

  console.log('\nMigración completada ✔');
}

main().catch(err => {
  console.error(`\nFalló la migración: ${err.message}`);
  process.exit(1);
});
