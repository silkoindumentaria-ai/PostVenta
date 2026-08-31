-- Migración: alta automática de mayoristas por tipo de cliente de Gestion Moda.
-- Ejecutar UNA sola vez en: Supabase Dashboard → SQL Editor → New query → pegar y Run.
-- Todo aditivo (`if not exists`): no rompe nada de lo que ya está andando.

-- El tipo de cliente que GM usa para "Mayorista". Es configurable porque la API NO
-- expone la etiqueta: /clientes devuelve client_type_id (un número) y no existe
-- endpoint de catálogo de tipos (/tipos-clientes, /client-types → 404). Verificado
-- contra la API real: el tipo 3 son los 90 mayoristas.
alter table wholesale_settings
  add column if not exists gm_client_type_ids int[] not null default '{3}',
  add column if not exists auto_import boolean not null default true;

-- source: 'gm_auto' = lo trajo el import por tipo | 'manual' = alta a mano.
--         El import NUNCA archiva ni pisa a los manuales.
-- gm_type_ok: false = ya no figura como Mayorista en GM (le cambiaron el tipo o lo
--         dieron de baja). El de la UI es un cartel, no una baja: nunca se borra.
alter table wholesale_clients
  add column if not exists source text not null default 'manual',
  add column if not exists gm_type_ok boolean not null default true;

-- El espejo del padrón pasa a guardar el tipo y el email, que /clientes ya devuelve
-- y hasta ahora se descartaban.
alter table gm_clients
  add column if not exists client_type_id int,
  add column if not exists email text;

create index if not exists gm_clients_type_idx on gm_clients (client_type_id);

-- Última corrida del import de clientes. Va en wholesale_sync_state (que ya existe
-- y tiene una sola fila, id = 1) para no sumar otra tabla de estado.
alter table wholesale_sync_state
  add column if not exists clients_imported_at timestamptz,
  add column if not exists clients_imported int not null default 0;
