-- Migración: espejo del padrón de clientes de Gestion Moda.
-- Ejecutar UNA sola vez en: Supabase Dashboard → SQL Editor → New query → pegar y Run.
-- (Ya está incluido en supabase-schema.sql; este archivo es para bases ya creadas.)

create table if not exists gm_clients (
  id bigint primary key,
  name text,
  phone text,                -- cellphone_number || phone_number, trimmeado
  phone_normalized text,     -- normalizePhone(phone), para cruzar con contact_logs
  email text,
  client_type_id int,        -- tipo de cliente en GM; el 3 es "Mayorista"
  active boolean,
  synced_at timestamptz not null default now()
);

create index if not exists gm_clients_phone_idx on gm_clients (phone_normalized);
create index if not exists gm_clients_synced_idx on gm_clients (synced_at desc);
create index if not exists gm_clients_type_idx on gm_clients (client_type_id);

create table if not exists gm_sync_state (
  id smallint primary key default 1,
  status text not null default 'idle',   -- 'idle' | 'running' | 'error'
  page int not null default 0,
  total_pages int not null default 0,
  clients_synced int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error text
);

insert into gm_sync_state (id) values (1) on conflict (id) do nothing;

alter table gm_clients enable row level security;
alter table gm_sync_state enable row level security;
