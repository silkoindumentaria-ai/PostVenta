# PostVenta Silko — Contexto del Proyecto

Panel web para gestionar campañas de postventa por WhatsApp, consultando ventas desde la API de Gestion Moda y registrando el progreso de contacto por cliente.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 5 + `lucide-react` (iconos) |
| Backend | Node.js + Express 4 (CommonJS) |
| Base de datos | Supabase (Postgres) vía `@supabase/supabase-js` — sin ORM ni drivers nativos |
| HTTP client (backend) | Axios |
| Deploy | Render (plan free, `render.yaml`) |
| Repositorio | https://github.com/silkoindumentaria-ai/PostVenta |

---

## Estructura de archivos

```
PostVenta-Online/
├── CLAUDE.md                        ← este archivo
├── package.json                     ← raíz: scripts build/start
├── render.yaml                      ← blueprint de deploy para Render
├── nixpacks.toml                    ← legacy Railway (ya no se usa)
├── .gitignore
│
├── backend/
│   ├── server.js                    ← servidor Express + API de PostVenta (sesiones/contactos)
│   ├── wholesale.js                 ← router /api/wholesale: módulo de mayoristas
│   ├── lib/
│   │   ├── db.js                    ← cliente Supabase + fetchAllRows/insertRows/upsertRows + normalizePhone
│   │   └── gm.js                    ← axios `gm` + cola de rate limit + fetchAllSales/fetchSalesRange
│   ├── package.json                 ← deps: express, axios, cors, dotenv, @supabase/supabase-js
│   ├── .env                         ← GM_TOKEN, TN_*, SUPABASE_* (no va a git)
│   ├── supabase-schema.sql          ← schema de tablas (ejecutar 1 vez en Supabase SQL Editor)
│   ├── supabase-migration-gm-clients.sql  ← migración: gm_clients + gm_sync_state
│   ├── supabase-migration-wholesale.sql   ← migración: las 5 tablas de mayoristas
│   └── migrate-json-to-supabase.js  ← script one-shot: importa postventa.json a Supabase
│
└── frontend/
    ├── index.html
    ├── package.json                 ← deps: react, react-dom, lucide-react + vite
    ├── vite.config.js               ← proxy /api → localhost:3001, build → ../backend/public
    └── src/
        ├── main.jsx
        ├── App.jsx                  ← estado global, vistas (PostVenta/Mayoristas), tabs
        ├── App.css                  ← estilos de PostVenta + layout general
        ├── Wholesale.css            ← estilos del módulo de mayoristas (prefijo wh-)
        ├── index.css                ← variables CSS y reset
        ├── utils/
        │   ├── phone.js             ← normalización de teléfonos + links de WhatsApp
        │   └── format.js            ← fechas, montos, antigüedades (es-AR)
        └── components/
            ├── ContactsTable.jsx    ← tabla principal con filtros, progreso, links WSP
            ├── ClientsSync.jsx      ← botón + progreso del sync del padrón de clientes
            ├── HistoryModal.jsx     ← historial de contactos de un cliente (PostVenta)
            ├── ConfirmModal.jsx     ← confirmación genérica para acciones destructivas
            ├── icons.jsx            ← iconos propios (WhatsApp: lucide no trae marcas)
            ├── NewSessionModal.jsx  ← modal para crear nueva sesión de postventa
            └── wholesale/
                ├── WholesalePanel.jsx        ← contenedor: agenda, filtros, grilla, sync
                ├── WholesaleCard.jsx         ← tarjeta CRM de un mayorista
                ├── WholesaleClientModal.jsx  ← ficha: métricas, ventas, timeline
                ├── AddWholesaleModal.jsx     ← alta: buscador del padrón GM o manual
                ├── ContactLogModal.jsx       ← registrar/editar un contacto
                └── WholesaleSettingsModal.jsx ← umbrales y vendedores
```

**Importante:** `lib/gm.js` exporta una única instancia axios `gm` compartida por todo el
backend. El caché de módulos de Node garantiza que la cola de rate limit sea una sola.

---

## Cómo correr localmente

```bash
# Terminal 1 — backend (puerto 3001)
cd backend
npm run dev        # usa nodemon

# Terminal 2 — frontend (puerto 5173)
cd frontend
npm run dev
# → abrir http://localhost:5173
```

El frontend en dev proxea `/api/*` automáticamente al backend en 3001 (configurado en `vite.config.js`).

## Deploy a producción

```bash
# Pushear a GitHub — Render redespliega automáticamente
git add .
git commit -m "descripción"
git push
```

Render detecta el push, ejecuta el build definido en `render.yaml` (instala deps, buildea frontend a `backend/public/`, arranca backend) y redespliega en unos minutos.

**Ojo (plan free de Render):** el servicio se duerme tras 15 minutos sin tráfico; la primera visita después tarda ~30-60 segundos en responder. Los datos no se pierden (viven en Supabase).

---

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `GM_TOKEN` | Render + `.env` local | Bearer token para API Gestion Moda |
| `TN_ACCESS_TOKEN` | Render + `.env` local | Token de Tienda Nube |
| `TN_STORE_ID` | Render + `.env` local | ID de tienda TN (1406056) |
| `SUPABASE_URL` | Render + `.env` local | URL del proyecto Supabase (`https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Render + `.env` local | Service role / secret key de Supabase (bypasea RLS; solo backend, nunca al frontend) |
| `PORT` | Render (auto) | Puerto del servidor. Render lo inyecta automáticamente |

El servidor hace `process.exit(1)` al arrancar si faltan `SUPABASE_URL` o `SUPABASE_SERVICE_KEY`.

---

## API de Gestion Moda

**Base URL:** `https://gestion.moda/api/v1`  
**Auth:** `Authorization: Bearer <GM_TOKEN>` en cada request  
**Timeout:** 30 segundos

### ⚠ Rate limit: 60 requests/minuto, compartido

La API responde con los headers `X-RateLimit-Limit: 60` y `X-RateLimit-Remaining`, y el
contador es **compartido entre todos los endpoints** (`/ventas/obtener` y `/clientes`
descuentan del mismo bucket). Pasarse devuelve `429`.

`server.js` tiene un **limitador global** (interceptor de request sobre la instancia axios
`gm`) que serializa todas las llamadas en una cola FIFO con ventana deslizante de
**50 req/min**, más un interceptor de response que reintenta ante `429`/`503` respetando
`Retry-After`. **Toda llamada a GM debe pasar por la instancia `gm`** — no crear otro
cliente axios ni usar `axios.get` directo contra `gestion.moda`, porque se saltea la cola.

### Endpoints usados

#### `GET /ventas/obtener`
Devuelve ventas paginadas.

Parámetros relevantes:
| Param | Tipo | Descripción |
|---|---|---|
| `from` | string | Fecha desde (YYYY-MM-DD) |
| `to` | string | Fecha hasta (YYYY-MM-DD) |
| `channel_id` | integer | Filtrar por canal de venta |
| `store_id` | integer | Filtrar por tienda/local |
| `per_page` | integer | Máximo 200 |
| `page` | integer | Paginación |
| `include_details` | 0/1 | Incluir líneas de detalle |
| `include_payments` | 0/1 | Incluir pagos |

Campos relevantes de cada venta en la respuesta:
```json
{
  "id": 1247695,
  "date_sale": "2026-05-21",
  "client_id": 587350,
  "client_name": "Luis Emiliano Arce",
  "client_phone": "",
  "channel_id": 883,
  "channel": "Whatsapp",
  "store_id": 4736,
  "store": "Local - Galeria Florida",
  "client": {
    "id": 587350,
    "name": "Luis Emiliano Arce",
    "email": "",
    "phone_number": "",
    "address": "", "city": "", "province": "", "postal_code": ""
  },
  "meta": { "has_more_pages": true, "last_page": 50 }
}
```

**Importante — este endpoint NUNCA devuelve el celular.** El sub-objeto `client` de una
venta solo trae `id, name, email, phone_number, address, city, province, postal_code`:
**el campo `cellphone_number` no existe acá**, y `phone_number` viene vacío en la práctica.
El celular vive únicamente en `GET /clientes`. Por eso los teléfonos salen del espejo
`gm_clients` (ver más abajo), cruzando por `client_id`.

**Tampoco permite filtrar por cliente:** no hay param `client_id`. Para traer las ventas
de un cliente puntual está la otra ruta, `GET /ventas` (abajo).

#### `GET /ventas` — la ruta REST, distinta de `/ventas/obtener`

Misma entidad, pero acepta **`search`**, que matchea por cliente, número, email, factura o
comentario. Es la que usa el módulo de mayoristas para traer las compras de un cliente en
1-2 requests, en vez de escanear meses enteros de ventas de todo el negocio.

| Param | Descripción |
|---|---|
| `search` | Cliente, número, email, factura o comentario |
| `from` / `to` | Acotan por fecha, igual que `/ventas/obtener` |
| `per_page` / `page` | Paginación estándar (`meta.last_page`, `meta.has_more_pages`) |

Verificado contra la API real:

- **`search` SÍ maneja bien la ñ y los acentos**, al revés que el `q` de `/clientes`:
  `search=INDIANA ANABEL MUÑOZ` devuelve la venta correcta. No hay que plegar acentos acá.
- Sin `from`/`to` devuelve **todo el historial** del cliente.
- **`items_sold`, `items_lines`, `total_price`, `channel`, `store`, `budget` y `active`
  vienen aunque `include_details` sea 0.** No hace falta pedir detalles para saber las
  unidades de una venta — solo para el desglose de productos.
- `search` puede traer ventas de otros clientes (matchea también comentarios), así que
  **siempre hay que filtrar por `client_id`** después.

#### `GET /clientes`
Lista/busca clientes.

Parámetros:
| Param | Descripción |
|---|---|
| `q` | Búsqueda por nombre, email, teléfono, CUIT/DNI |
| `per_page` | Máximo 200 |

**No existe `GET /clientes/{id}`.** Tampoco se puede buscar por id: `q` busca en nombre,
email, teléfono y CUIT/DNI, pero **no** en el id (`q=240537` devuelve 0 resultados).

**⚠ Bug de encoding en `q`:** GM tiene los nombres guardados con un encoding roto, así que
la búsqueda falla con ñ y acentos. Verificado: `q=MUÑOZ` → **0 resultados**;
`q=MUNOZ` → **71 resultados**. Buscar clientes por nombre completo es poco confiable.

**Por eso el padrón se baja entero:** hay ~27.500 clientes = **138 páginas** con
`per_page=200`, menos requests que buscar cliente por cliente, y el cruce por `client_id`
es exacto. La paginación es la estándar (`page`, `meta.last_page`, `meta.has_more_pages`)
y el orden es **alfabético por nombre**, no por id.

Campos relevantes de cada cliente:
```json
{
  "id": 502026,
  "name": "Gustavo Rene Moreno",
  "phone_number": "",
  "cellphone_number": "+549299 5736820"
}
```

---

## Base de datos (Supabase / Postgres)

Cinco tablas, definidas en `backend/supabase-schema.sql`. Todas con RLS activado **sin políticas**: solo el backend accede, usando la service key (que bypasea RLS). El acceso desde el backend es vía `@supabase/supabase-js` (REST/PostgREST, sin conexión directa a Postgres).

**No se puede hacer DDL desde el backend** (PostgREST no lo permite): las tablas nuevas se crean pegando el SQL en Supabase Dashboard → SQL Editor. `backend/supabase-migration-gm-clients.sql` es la migración de `gm_clients` + `gm_sync_state` para bases ya creadas.

**Límite importante de PostgREST:** máximo 1000 filas por request. `server.js` tiene el helper `fetchAllRows()` que pagina con `.range()` — usarlo para cualquier query que pueda devolver muchas filas (ej. contactos de una sesión).

### Tabla `sessions`

```sql
id bigint identity PK,
name text not null,
source text not null default 'gm',   -- 'gm' | 'tn'
channel_id bigint,                   -- null = todos los canales
channel_name text,
store_id bigint,                     -- null = todas las tiendas
store_name text,
date_from date not null,
date_to date not null,
whatsapp_message text,               -- [Nombre] se reemplaza con el primer nombre
status text not null default 'active',  -- 'active' | 'finished'
created_at timestamptz default now()
```

### Tabla `contacts`

```sql
id bigint identity PK,
session_id bigint not null → sessions(id),
sale_id bigint,                      -- ID de la venta en GM / orden en TN
client_id bigint,                    -- ID del cliente en GM / customer en TN
client_name text not null,
client_phone text,                   -- null si no tiene teléfono
date_sale date,
contacted boolean default false,
contacted_at timestamptz             -- null si no contactado
```

### Tabla `contact_logs` (historial, nunca se borra)

```sql
id bigint identity PK,
contact_id bigint, session_id bigint, session_name text, source text,
client_id bigint, client_name text,
client_phone_raw text, client_phone_normalized text,  -- normalizado a 549XXXXXXXXXX
message text, contacted_at timestamptz
```

Se inserta una fila cada vez que se marca un contacto como contactado. El historial de un cliente se busca por `client_phone_normalized` (o `client_id`+`source` si no hay teléfono), lo que permite cruzar al mismo cliente entre sesiones y fuentes distintas.

### Tabla `gm_clients` (espejo del padrón de Gestion Moda)

```sql
id bigint PK,              -- id del cliente en GM (NO identity: lo dicta GM, se usa upsert)
name text,
phone text,                -- cellphone_number || phone_number
phone_normalized text,     -- normalizePhone(phone)
active boolean,
synced_at timestamptz default now()
```

**Es la fuente de los teléfonos de las sesiones GM.** Como `/ventas/obtener` no devuelve el
celular y `q` no sirve para buscar por nombre (ver el bug de encoding arriba), se baja el
padrón completo paginado y el teléfono se cruza localmente por `client_id` — **0 requests a
GM al crear una sesión**.

### Tabla `gm_sync_state` (una sola fila, `id = 1`)

```sql
id smallint PK default 1,
status text default 'idle',   -- 'idle' | 'running' | 'error'
page int, total_pages int, clients_synced int,
started_at timestamptz, finished_at timestamptz, error text
```

Progreso del sync del padrón, que el frontend poletea cada 3 s. Un `running` de más de
15 minutos se considera muerto y se permite arrancar otro.

### Tablas del módulo de mayoristas

Definidas en `backend/supabase-migration-wholesale.sql`. Ver la sección **Mayoristas** más abajo.

| Tabla | Para qué |
|---|---|
| `wholesale_clients` | El mayorista. `gm_client_id` null = alta manual. Tiene `next_contact_date` / `last_contact_date` desnormalizados del último contacto, `tags text[]`, `assigned_to`, y `sales_synced_at` (null = pendiente de backfill) |
| `wholesale_contacts` | Timeline de contactos: `contacted_at`, `note`, `outcome`, `next_contact_date`, `seller` |
| `wholesale_sales` | Espejo de ventas de GM de los mayoristas, **solo totales**. PK = id de la venta en GM (upsert idempotente) |
| `wholesale_sync_state` | Progreso del sync de ventas (una fila, `id = 1`). `page`/`total_pages` cuentan **meses**, no páginas |
| `wholesale_settings` | Una fila (`id = 1`): `warn_days`, `alert_days`, `history_months`, `sellers text[]` |

---

## API del backend (endpoints propios)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Health check (Render + monitores de uptime) |
| `GET` | `/api/channels-stores` | Canales y tiendas disponibles (últimos 6 meses) |
| `GET` | `/api/sessions` | Sesiones activas con conteos de progreso |
| `POST` | `/api/sessions` | Crear sesión GM (fetcha ventas, guarda contactos) |
| `POST` | `/api/tn/sessions` | Crear sesión Tienda Nube (fetcha órdenes pagas) |
| `GET` | `/api/sessions/:id/contacts` | Sesión + lista de contactos |
| `POST` | `/api/sessions/:id/refresh-phones` | Completa teléfonos faltantes cruzando contra `gm_clients` |
| `POST` | `/api/clients/sync` | Dispara el sync del padrón en background; responde `202` al toque |
| `GET` | `/api/clients/sync-status` | Progreso del sync + `total_clients` + `synced_at` + `stale` |
| `PATCH` | `/api/sessions/:id/finish` | Archivar sesión (status → "finished") |
| `PATCH` | `/api/contacts/:id` | Toggle contacted; al marcar, registra en `contact_logs` |
| `GET` | `/api/contacts/:id/history` | Historial de contactos del mismo cliente |

### Módulo de mayoristas (`backend/wholesale.js`, montado en `/api/wholesale`)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/clients` | Listado con métricas, semáforo, último y próximo contacto + `settings` + `today` |
| `POST` | `/clients` | Alta. `{ gm_client_id }` para vincular con GM, o `{ name, phone, ... }` manual. `409` si ya existe |
| `GET` | `/clients/search?q=` | Busca en `gm_clients` por nombre o teléfono; marca los ya cargados |
| `GET` | `/clients/:id` | Ficha: cliente + métricas + ventas + timeline de contactos |
| `PATCH` | `/clients/:id` | Editar datos o archivar (`status: 'archived'`) |
| `DELETE` | `/clients/:id` | **Borra** el cliente, sus contactos (cascade) y sus ventas cacheadas |
| `POST` | `/clients/:id/refresh` | Trae de GM el teléfono, el email y las ventas al día de ese cliente. Síncrono, ~2 requests |
| `POST` | `/clients/:id/contacts` | Registrar contacto; actualiza los desnormalizados del cliente |
| `PATCH` `/` `DELETE` | `/contacts/:id` | Corregir o borrar un contacto cargado por error |
| `POST` | `/sales/sync` | Refresca todos los mayoristas en background; responde `202` |
| `GET` | `/sales/sync-status` | Progreso (**cliente N de M**) + `pending_backfill` + `total_sales` |
| `GET` `/` `PATCH` | `/settings` | Umbrales del semáforo, meses de histórico y vendedores |

**Ojo con el orden de rutas:** `/clients/search` se declara antes que `/clients/:id`, si no
Express matchea `:id = 'search'`. Y `app.use('/api/wholesale', ...)` va **antes** del
catch-all `app.get('*')` de `server.js`, que si no se traga todas estas rutas.

**Archivar vs Eliminar** — son dos cosas distintas y conviven a propósito:

| | Qué hace | Cuándo |
|---|---|---|
| **Archivar** (`PATCH status: 'archived'`) | Lo saca del listado y de la agenda, conserva contactos y ventas. **Reversible** | El mayorista que dejó de comprar, por si vuelve |
| **Restaurar** (`PATCH status: 'active'`) | Lo devuelve al listado con todo su historial | Volvió a comprar, o se archivó sin querer |
| **Eliminar** (`DELETE`) | Borra el cliente, sus contactos y sus ventas cacheadas. Irreversible | El que se cargó por error |

Los archivados se ven con la píldora **"Archivados"** del panel. El frontend pide
`GET /clients?archived=1` **siempre** (una sola llamada trae activos + archivados) y separa
las dos listas en memoria: la agenda, los contadores y el resto de los filtros trabajan solo
con los activos. Restaurar no pide confirmación porque no destruye nada.

Ambos, y el borrado de un contacto, se confirman con `components/ConfirmModal.jsx` — no con
`window.confirm`, que es fácil de aceptar sin leer.

### POST /api/sessions — body esperado
```json
{
  "name": "PostVenta Mayo",
  "channel_id": 883,
  "store_id": 4736,
  "date_from": "2026-05-01",
  "date_to": "2026-05-21",
  "whatsapp_message": "Hola [Nombre], ..."
}
```

---

## Frontend — componentes

### App.jsx
Estado global de la app:
- `sessions` — array de sesiones activas con `total_contacts` y `contacted_count`
- `activeId` — ID de la sesión en la pestaña activa
- `sessionData` — `{ session, contacts }` de la sesión activa

Funciones principales:
- `fetchSessions()` — carga sesiones al montar
- `handleSessionCreated(session)` — agrega nueva sesión a las tabs
- `handleFinishSession(id)` — archiva sesión y la saca de las tabs
- `handleContactToggle(contactId, contacted)` — actualiza checkbox y actualiza contadores en tabs

### ContactsTable.jsx
Recibe: `{ session, contacts, onToggle, onFinish }`

Funciones internas:
- `formatPhoneForWhatsApp(raw)` — normaliza número argentino al formato `549XXXXXXXXXX`
- `buildWhatsAppUrl(phone, message, clientName)` — genera URL `https://wa.me/...?text=...` reemplazando `[Nombre]` con el primer nombre del cliente
- Filtros locales: búsqueda por texto + tabs "Todos / Pendientes / Contactados"

### NewSessionModal.jsx
- Al abrirse, fetcha `/api/channels-stores` para poblar los dropdowns
- Fechas default: última semana
- Mensaje default hardcodeado en el componente
- Al crear, llama `POST /api/sessions` que puede tardar 30-60s (fetcha todas las páginas de GM + enriquece teléfonos)

---

## WhatsApp — formato de URL

```
https://wa.me/549XXXXXXXXXX?text=Mensaje%20URL-encoded
```

Normalización de teléfonos argentinos en `ContactsTable.jsx`:
1. Eliminar todo lo que no sea dígito
2. Si empieza en `0` y tiene más de 10 dígitos → sacar el `0`
3. Si empieza en `54` pero no en `549` → insertar `9` después del `54`
4. Si no empieza en `54` → anteponer `549`

---

## Render — configuración de deploy

Definido en **render.yaml** (en raíz): servicio web Node en plan free, build `npm --prefix backend install --omit=dev && npm --prefix frontend install && npm --prefix frontend run build`, start `node backend/server.js`, health check en `/api/health`.

Las env vars (`GM_TOKEN`, `TN_ACCESS_TOKEN`, `TN_STORE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) se cargan en el dashboard de Render (están declaradas con `sync: false` en el yaml).

**El frontend buildeado** queda en `backend/public/` y es servido como archivos estáticos por Express.

**Historia:** el proyecto vivió en Railway (volumen `/data` + `postventa.json`) hasta julio 2026; se migró a Render + Supabase cuando terminó el plan gratuito de Railway. `nixpacks.toml` quedó como legacy.

---

## Tienda Nube — integración

**Credenciales (en Render env vars y backend/.env):**
- `TN_ACCESS_TOKEN` — bearer token
- `TN_STORE_ID` — 1406056

**Base URL:** `https://api.tiendanube.com/v1/{TN_STORE_ID}`  
**Auth header:** `Authentication: bearer {TN_ACCESS_TOKEN}`  
**User-Agent:** `SilkoPostVenta (gabrieldecima1028@gmail.com)` — requerido por TN

### Endpoint usado: `GET /orders`

Parámetros:
| Param | Valor fijo/variable |
|---|---|
| `payment_status` | `paid` (solo órdenes pagas) |
| `created_at_min` | date_from del formulario |
| `created_at_max` | date_to + `T23:59:59+0000` |
| `per_page` | 200 (máximo) |
| `page` | paginación |
| `fields` | `id,number,created_at,contact_name,contact_phone,contact_email,customer` |

**La respuesta es un array directo** (no `{data: [...]}` como GM). Paginación: si el array tiene < 200 items, es la última página.

Campos relevantes de cada orden:
```json
{
  "id": 1976331980,
  "number": 18983,
  "created_at": "2026-05-21T17:06:20+0000",
  "contact_name": "Morgan Pereyra",
  "contact_phone": "+543515931246",
  "contact_email": "morganpereyra2@gmail.com",
  "customer": { "id": 216081176, "phone": "+543515931246" }
}
```

**Los teléfonos de TN ya vienen con código de país** (`+549...`), no necesitan normalización adicional.

### Endpoint backend: `POST /api/tn/sessions`

Body igual a GM pero sin `channel_id` ni `store_id`:
```json
{ "name": "...", "date_from": "2026-05-01", "date_to": "2026-05-21", "whatsapp_message": "..." }
```

Las sesiones TN se guardan con `source: "tn"` en la tabla `sessions`.

### UI — selector de fuente

En el header hay dos botones: **Gestion Moda** (verde) y **Tienda Nube** (violeta). Cada uno muestra sus propias pestañas de sesiones. El estado `activeSource` en `App.jsx` controla cuál está visible. `activeId` es un objeto `{ gm: id|null, tn: id|null }` para recordar la pestaña activa de cada fuente independientemente.

El modal `NewSessionModal` recibe `source` como prop y adapta:
- `source === 'tn'`: sin dropdowns de canal/tienda, llama a `POST /api/tn/sessions`
- `source === 'gm'`: comportamiento original

---

## Mayoristas — módulo de seguimiento

Segunda vista del panel, independiente de las sesiones de PostVenta. Mientras PostVenta
trabaja por **campañas masivas y puntuales**, este módulo hace **seguimiento individual y
continuo** de los clientes mayoristas: qué compran, cuándo se los contactó, qué dijeron y
cuándo hay que volver a llamarlos.

En `App.jsx` el estado `view` (`'postventa' | 'mayoristas'`) es **ortogonal a
`activeSource`**: cambiarlo oculta el selector de fuente, la tabs-bar y el botón de nueva
sesión, y monta `WholesalePanel`. El badge rojo del botón "Mayoristas" cuenta los contactos
vencidos + los de hoy.

### Flujo de trabajo

1. **Alta**: se busca el cliente en el espejo `gm_clients` y se lo vincula por `gm_client_id`
   (o se lo carga a mano si no existe en GM, sin historial de ventas).
2. **Sync de ventas**: el botón "Sincronizar ventas" refresca todos los mayoristas; el
   botón ⟳ de cada tarjeta refresca uno solo en un par de segundos.
3. **Seguimiento**: por cada WhatsApp se registra fecha, nota de lo que dijo, resultado
   (compró / va a comprar / pidió info / no contesta / no le interesa), vendedor y próximo
   contacto (con atajos +7d / +15d / +30d).
4. **Agenda**: los clientes con próximo contacto vencido, de hoy o de esta semana aparecen
   arriba de todo en el panel.

### `refreshClientFromGm()` — el núcleo de todo

Toda la actualización contra GM pasa por esta función de `wholesale.js`. La usan **tanto el
botón ⟳ de la tarjeta como el sync completo**, que no es más que un `for` sobre los clientes
activos. Cuesta ~2 requests por cliente y tarda unos 2-3 segundos.

**Detalle contraintuitivo, no lo "arregles":** el nombre del cliente se manda de dos formas
distintas según el endpoint.

| Paso | Endpoint | Nombre | Por qué |
|---|---|---|---|
| Teléfono + email | `GET /clientes?q=` | **plegado** (`MUÑOZ` → `MUNOZ`) | GM guarda los nombres con encoding roto: con ñ devuelve 0 resultados |
| Ventas | `GET /ventas?search=` | **tal cual** | Esta ruta sí maneja bien ñ y acentos |

Otros puntos:

- **Datos de contacto**: los busca `lookupGmContact()`, que trae **teléfono y email**
  (`cellphone_number || phone_number`, y `email`). No existe `GET /clientes/{id}` y `q` no
  busca por id, así que se busca por nombre y se **matchea por id** entre los resultados; si
  el nombre completo no lo trae, se reintenta con la palabra más larga (el apellido).
- El teléfono encontrado se escribe también en `gm_clients`, así el espejo queda fresco para
  el resto del panel. **El email no**: `gm_clients` no tiene esa columna, vive solo en
  `wholesale_clients`.
- `lookupGmContact()` la usa también el **alta** (`POST /clients`): el espejo del padrón no
  guarda email y su teléfono puede estar vencido, así que se consulta GM en vivo (1 request)
  para que la ficha no nazca incompleta. Si esa consulta falla, el alta sigue igual con los
  datos del espejo y el botón ⟳ lo completa después.
- **Ventas**: `search` puede traer ventas de otros clientes (matchea comentarios), así que se
  filtra por `client_id`. Se saltean presupuestos (`budget`) y anuladas (`active === false`).
- **Idempotente**: el upsert es por id de venta. Los ids locales se leen **antes** de escribir
  para poder distinguir las ventas nuevas de las ya conocidas en el resumen que ve el usuario.
- **Limpia lo que ya no está**: las ventas locales del rango que GM ya no devuelve se borran
  (se anularon), para que las métricas no mientan.
- **El sync completo no aborta si un cliente falla**: lo loguea, sigue con el resto y reporta
  los errores al final.

### Métricas y semáforo

Las métricas (ventas, unidades, facturado, ticket promedio, última compra, frecuencia de
compra) se **calculan al leer**, no se almacenan: son pocas decenas de mayoristas y unos
miles de filas, así que agregarlas en Node es instantáneo y nunca quedan desactualizadas.

El semáforo compara los días sin comprar contra `warn_days` / `alert_days` de
`wholesale_settings` (30 / 60 por defecto, editables desde ⚙ Configuración).

---

## Decisiones de diseño importantes

- **Supabase por REST, sin drivers nativos:** se usa `@supabase/supabase-js` (HTTP puro) en vez de `pg` o SQLite para evitar compilación nativa y problemas de conexión directa a Postgres desde Render.
- **Persistencia:** los datos viven en Supabase (plan free), separados del hosting. Render free no tiene disco persistente — no escribir nada en el filesystem que deba sobrevivir un deploy.
- **IDs preservados:** la migración desde `postventa.json` conservó los IDs originales (`generated by default as identity` + `reset_id_sequences()`).
- **Teléfonos (GM):** el celular no viene en las ventas y no hay `/clientes/{id}`, así que se mantiene un **espejo del padrón** en `gm_clients` y el cruce venta→teléfono es un JOIN local por `client_id`. El sync se dispara con el botón "Sincronizar clientes" del header, y automáticamente en background cuando el espejo pasa las 24 h. Si el cliente no tiene teléfono cargado en GM, queda `null` (sin solución desde la app).
- **Rate limit de GM:** todas las llamadas pasan por una cola FIFO global de 50 req/min definida en `lib/gm.js`. El sync completo del padrón tarda ~3 min por eso; corre en background y el panel muestra el progreso.
- **Sesiones finalizadas:** se marcan con `status: "finished"` pero los datos NO se borran. Solo desaparecen de la vista.
- **Ventas de mayoristas:** se traen cliente por cliente con `GET /ventas?search=<nombre>` (~2 requests c/u) en vez de escanear meses de ventas de todo el negocio. El costo escala con la cantidad de mayoristas, no con el volumen de ventas. Se guardan **solo totales** por venta — `items_sold` y `total_price` — sin líneas de producto.
- **Historial separado:** el módulo de mayoristas tiene su propio timeline (`wholesale_contacts`) y **no cruza** con los `contact_logs` de las campañas de PostVenta: son dos tipos de contacto distintos y mezclarlos ensuciaba el seguimiento personal.
- **Helpers compartidos en el frontend:** la normalización de teléfonos y el formateo de fechas/montos viven en `src/utils/` y los importan tanto PostVenta como Mayoristas, para no tener tres copias divergentes de la misma lógica.
- **Iconos con `lucide-react`:** se importan de a uno (`import { RefreshCw } from 'lucide-react'`) para que el tree-shaking deje afuera el resto — los ~20 que usa el panel pesan ~2,6 kB gzip. Reemplazaron a los emojis, que se veían distinto en cada sistema operativo. Lo único a mano es el glifo de WhatsApp en `components/icons.jsx`, porque lucide no incluye logos de marcas. La clase `.icon-spin` de `App.css` hace girar cualquier icono que indique "en curso".
- **Tarjeta de mayorista clickeable:** toda la tarjeta abre la ficha; cada control interno (WhatsApp, registrar, refrescar, menú) corta la propagación con el helper `stop()`. Archivar y eliminar se ofrecen desde el menú ⋮ de la tarjeta **y** desde la ficha: la confirmación vive en `WholesalePanel` para que el texto sea uno solo.
- **Sin autenticación:** acceso abierto por diseño inicial. El vendedor se elige de una lista fija configurable (`wholesale_settings.sellers`), no hay login.
